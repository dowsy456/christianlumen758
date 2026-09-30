/* Cold 12k-message rooms, blocked storage, real DOM, bounded query semantics.
 * Timings include deterministic simulated network latency; they are local QA
 * measurements, not a promise about production networks/devices.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const installFixture = require('./room-loading-fixture.cjs');
const root = path.resolve(__dirname, '..');
const reportDirectory = path.resolve(process.argv[2] || path.join(root, '../room-loading-report'));
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file, (error, bytes) => {
    response.writeHead(error ? 404 : 200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' });
    response.end(error ? 'Missing fixture asset' : bytes);
  });
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(40); }
  throw Error(message);
}
async function waitLoaded(page, room) {
  await page.waitForFunction(id => ChatApp.currentRoomId === id && !ChatApp.msgInitialTailPending && !ChatApp.bulkLoading && !ChatApp.roomLoadingActive && !ChatApp.roomEntryScroll, room);
}
async function openMeasured(page, room, name) {
  await page.evaluate(({ room, name }) => {
    const mark = { name, room, startedAt: performance.now(), firstRowsAt: null };
    window.__roomMarks.push(mark); window.__activeRoomMark = mark;
    void ChatApp.openRoom(room, { quiet: true });
  }, { room, name });
  await waitLoaded(page, room);
  return page.evaluate(() => {
    const mark = window.__activeRoomMark;
    mark.finishedAt = performance.now();
    mark.firstRowsMs = mark.firstRowsAt === null ? null : mark.firstRowsAt - mark.startedAt;
    mark.readyMs = mark.finishedAt - mark.startedAt;
    mark.rows = ChatApp.msgElByKey.size;
    return { ...mark };
  });
}
function assertBounded(traces) {
  const requests = traces.filter(item => ['on', 'once'].includes(item.kind));
  assert.ok(requests.length > 0, 'message requests were recorded');
  for (const request of requests) {
    if (request.path.split('/').length > 2) continue;
    const query = request.query;
    assert.ok(query.limitToLast || query.limitToFirst || query.startAt != null && query.endAt != null,
      `Unbounded message request: ${JSON.stringify(request)}`);
    assert.ok(request.records <= 121, `Unexpectedly large query payload: ${request.records}`);
  }
}
(async () => {
  fs.mkdirSync(reportDirectory, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const results = [];
  try {
    for (const mode of ['http', 'file']) {
      const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      await context.addInitScript(installFixture, { count: 12000, latencyMs: 120, blockedStorage: true });
      if (mode === 'file') await context.addInitScript(() => { window.chatDesktopRings = {version:1}; });
      const remoteMessageRequests = [];
      await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => {
        if (/\/messages\//.test(route.request().url())) remoteMessageRequests.push(route.request().url());
        return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'null' });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) { errors.push(message.text()); console.error(`${mode}: ${message.text()}`); } });
      const result = { mode, storage: 'localStorage and sessionStorage methods throw SecurityError', historicalMessagesPerRoom: 12000, latencyMs: 120, phases: [] };
      results.push(result);
      try {
        await page.goto(mode === 'http' ? `http://127.0.0.1:${server.address().port}/index.html` : pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
        await page.click('#btn-go-login'); await page.fill('#login-code', 'TEST-USER'); await page.click('#btn-login');
        await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER' && ChatApp.views.chat.dataset.active === 'true' && ChatApp.membershipMap.has('test'));
        await page.evaluate(() => {
          window.__roomMarks = []; window.__activeRoomMark = null; window.__roomLongTasks = [];
          if (typeof PerformanceObserver === 'function') {
            try { new PerformanceObserver(list => window.__roomLongTasks.push(...list.getEntries().map(item => ({ start: item.startTime, duration: item.duration })))).observe({ type: 'longtask', buffered: true }); } catch {}
          }
          new MutationObserver(() => {
            const mark = window.__activeRoomMark;
            if (mark && mark.room === ChatApp.currentRoomId && mark.firstRowsAt === null && ChatApp.messagesListEl.querySelector('.msg-row')) { mark.firstRowsAt = performance.now(); mark.firstRowsCount=ChatApp.messagesListEl.querySelectorAll('.msg-row').length; }
            if (mark && document.querySelector('#room-loading-state')) mark.sawLoader=true;
          }).observe(ChatApp.messagesListEl, { childList: true });
        });
        const cold = await openMeasured(page, 'test', 'cold 12k history');
        assert.equal(cold.rows, 60, 'cold load mounts only latest 60 messages');
        assert.equal(cold.firstRowsCount,60,'the complete initial tail appears in one paint');
        if(mode==='file') assert.equal(!!cold.sawLoader,false,'native window never flashes a room loading card');
        const coldState = await page.evaluate(() => ({ place: ChatApp.getStoredPlace(), keys: [...ChatApp.msgElByKey.keys()], traces: __roomLoadFixture.traces }));
        assert.equal(coldState.place, 'room:test', 'navigation works with both stores blocked');
        assert.equal(coldState.keys.sort()[0], 'k00011940');
        assert.equal(await page.evaluate(() => ChatApp.msgAllHistoryLoaded), false, 'stale messageCount=60 cannot hide 12k-record history');
        assertBounded(coldState.traces);
        assert.equal(remoteMessageRequests.length, 0, 'cold entry does not duplicate the live SDK read through eager REST');
        result.phases.push(cold);
        console.log(`${mode}: cold 12k room ready ${Math.round(cold.readyMs)} ms; first rows ${Math.round(cold.firstRowsMs)} ms.`);

        await openMeasured(page, 'second', 'cold second room');
        await page.evaluate(() => __roomLoadFixture.ref('messages/test/k00011959').remove());
        await page.evaluate(() => __roomLoadFixture.setLatency(600));
        const warm = await openMeasured(page, 'test', 'warm revisit from bounded volatile cache');
        assert.ok(warm.firstRowsMs < 450, `warm cache should paint before 600 ms simulated delivery (${warm.firstRowsMs} ms)`);
        assert.equal(warm.rows, 60);
        assert.equal(await page.evaluate(() => ChatApp.msgElByKey.has('k00011959')), false, 'live reconciliation removes a cached row deleted while away');
        const warmOldest = await page.evaluate(() => ChatApp.msgOldestKey);
        assert.equal(warmOldest, 'k00011939', 'fresh tail backfills the cached deletion');
        result.phases.push({ ...warm, latencyMs: 600 });
        await page.evaluate(() => __roomLoadFixture.setLatency(120));

        // Scrolling upward adds a single bounded page and retains the same
        // visible message position while new DOM nodes are prepended.
        const history = await page.evaluate(async () => {
          ChatApp.stopChatBottomFollowing(); ChatApp.messagesEl.scrollTop = 20;
          const anchor = ChatApp.messagesListEl.querySelector('.msg-row');
          const before = anchor.getBoundingClientRect().top;
          await ChatApp.loadOlderMessagesPage();
          const after = anchor.getBoundingClientRect().top;
          return { rows: ChatApp.msgElByKey.size, offsetDelta: after - before, oldest: ChatApp.msgOldestKey };
        });
        assert.equal(history.rows, 180);
        assert.ok(Math.abs(history.offsetDelta) < 3, 'history prepend preserves visible position');
        assert.equal(history.oldest, 'k' + String(Number(warmOldest.slice(1)) - 120).padStart(8, '0'));
        await page.evaluate(() => __roomLoadFixture.ref('messages/test/k00011825/text').set('Edited archived history'));
        await page.waitForFunction(() => ChatApp.msgDataByKey.get('k00011825')?.text === 'Edited archived history');
        await page.evaluate(() => __roomLoadFixture.ref('messages/test/k00011826').remove());
        await page.waitForFunction(() => !ChatApp.msgElByKey.has('k00011826'));
        result.phases.push({ name: '120-row history page stays live for edits/deletions', ...history });

        await page.evaluate(async () => {
          for (let index = 12000; index < 12065; index++) {
            await __roomLoadFixture.ref('messages/test/' + __roomLoadFixture.keyFor(index)).set({ userCode: 'TEST-USER', username: 'Tester', text: 'New live ' + index, createdAt: Date.now() + index });
          }
        });
        await page.waitForFunction(() => ChatApp.msgElByKey.has('k00012064'));
        assert.equal(await page.evaluate(() => ChatApp.msgElByKey.has('k00011940')), true, 'tail eviction does not remove an already loaded message');
        await page.evaluate(() => __roomLoadFixture.ref('messages/test/k00011940/text').set('Edited after eviction'));
        await page.waitForFunction(() => ChatApp.msgDataByKey.get('k00011940')?.text === 'Edited after eviction');
        await page.evaluate(() => __roomLoadFixture.ref('messages/test/k00011941').remove());
        await page.waitForFunction(() => !ChatApp.msgElByKey.has('k00011941'));
        assert.equal(await page.evaluate(() => document.querySelectorAll('.msg-row').length === new Set([...document.querySelectorAll('.msg-row')].map(row => row.dataset.msgkey)).size), true);
        result.phases.push({ name: '65 new messages retain historical rows and tail evictions stay editable' });

        // A held page response from room A must not mutate room B after switch.
        await page.evaluate(() => { __roomLoadFixture.holdHistory = true; window.__heldPage = ChatApp.loadOlderMessagesPage(); });
        await page.waitForFunction(() => __roomLoadFixture.pendingHistory() > 0);
        await openMeasured(page, 'second', 'switch while older page pending');
        await page.evaluate(async () => { __roomLoadFixture.releaseHistory(); await window.__heldPage; });
        assert.equal(await page.evaluate(() => [...ChatApp.msgDataByKey.values()].every(message => message.text.startsWith('second history'))), true, 'old room page never inserts into the new room');
        assert.equal(await page.evaluate(() => ChatApp.msgElByKey.size), 60);
        result.phases.push({ name: 'late history page is discarded after room switch' });

        await page.evaluate(() => { __roomLoadFixture.holdInitial = true; void ChatApp.openRoom('test', { quiet: true }); });
        await page.waitForFunction(() => __roomLoadFixture.pendingInitial() > 0 && ChatApp.msgElByKey.has('k00012064'));
        await page.evaluate(async () => {
          await __roomLoadFixture.ref('messages/test/k00012064').remove();
          await __roomLoadFixture.ref('messages/test/k00012063/text').set('Newest edit before initial snapshot');
        });
        await page.waitForFunction(() => !ChatApp.msgElByKey.has('k00012064') && ChatApp.msgDataByKey.get('k00012063')?.text === 'Newest edit before initial snapshot');
        await page.evaluate(() => __roomLoadFixture.releaseInitial());
        await waitLoaded(page, 'test');
        assert.equal(await page.evaluate(() => ChatApp.msgElByKey.has('k00012064')), false, 'late initial snapshot cannot resurrect a removed message');
        assert.equal(await page.evaluate(() => ChatApp.msgDataByKey.get('k00012063')?.text), 'Newest edit before initial snapshot', 'live edits win over initial seed');
        assert.equal(await page.evaluate(() => ChatApp.msgAllHistoryLoaded), false, 'filtered initial keys do not turn a full query into exhausted history');
        const continuedHistory = await page.evaluate(async () => {
          const before = ChatApp.msgElByKey.size;
          const previousOldest = ChatApp.msgOldestKey;
          await ChatApp.loadOlderMessagesPage();
          return { before, after: ChatApp.msgElByKey.size, previousOldest, oldest: ChatApp.msgOldestKey };
        });
        assert.ok(continuedHistory.after > continuedHistory.before && continuedHistory.oldest < continuedHistory.previousOldest, 'pagination remains possible after initial delete/backfill');
        result.phases.push({ name: 'delete and edit before initial snapshot remain authoritative' });

        // A timeout only dismisses loading; it must not disable reconciliation
        // of provisional cached rows when the network finally answers.
        await page.evaluate(async () => {
          await __roomLoadFixture.ref('messages/second/k00011999').remove();
          __roomLoadFixture.holdInitial = true;
          window.__hardTimeoutFired = false; window.__shortenedRoomTimer = false;
          window.__lateLoaderCalls = 0;
          window.__originalBeginRoomLoading = ChatApp.beginRoomLoading;
          ChatApp.beginRoomLoading = function (...args) { window.__lateLoaderCalls++; return window.__originalBeginRoomLoading.apply(this, args); };
          const originalSetTimeout = window.setTimeout;
          window.setTimeout = function (callback, delay, ...args) {
            if (delay === 8000 && !window.__shortenedRoomTimer) {
              window.__shortenedRoomTimer = true;
              return originalSetTimeout(() => { window.__hardTimeoutFired = true; callback(...args); }, 50);
            }
            return originalSetTimeout(callback, delay, ...args);
          };
          try { await ChatApp.openRoom('second', { quiet: true }); }
          finally { window.setTimeout = originalSetTimeout; }
        });
        await page.waitForFunction(() => window.__hardTimeoutFired && __roomLoadFixture.pendingInitial() > 0 && !ChatApp.bulkLoading && !ChatApp.msgInitialTailPending);
        assert.equal(await page.evaluate(() => ChatApp.msgElByKey.has('k00011999')), true, 'cached deleted row remains provisional while first snapshot is held');
        const loaderCallsBeforeLateSnapshot = await page.evaluate(() => window.__lateLoaderCalls);
        await page.evaluate(() => __roomLoadFixture.releaseInitial());
        await page.waitForFunction(() => !ChatApp.msgElByKey.has('k00011999') && ChatApp.msgElByKey.has('k00011939'));
        assert.equal(await page.evaluate(() => window.__lateLoaderCalls), loaderCallsBeforeLateSnapshot, 'late reconciliation does not recreate loading UI');
        assert.equal(await page.evaluate(() => !ChatApp.roomLoadingActive && !document.querySelector('#room-loading-state')), true);
        await page.evaluate(() => { ChatApp.beginRoomLoading = window.__originalBeginRoomLoading; });
        result.phases.push({ name: 'late initial snapshot reconciles warm cache after hard timeout without reopening loader', timerAcceleratedFromMs: 8000, timerAcceleratedToMs: 50 });

        await page.evaluate(() => { __roomLoadFixture.holdHistory = true; window.__pageHeldDuringClear = ChatApp.loadOlderMessagesPage(); });
        await page.waitForFunction(() => __roomLoadFixture.pendingHistory() > 0);
        await page.evaluate(() => __roomLoadFixture.ref('messages/second').remove());
        await page.waitForFunction(() => ChatApp.msgElByKey.size === 0 && document.querySelectorAll('.msg-row').length === 0 && !ChatApp.bulkLoading);
        await page.evaluate(async () => { __roomLoadFixture.releaseHistory(); await window.__pageHeldDuringClear; });
        assert.equal(await page.evaluate(() => ChatApp.msgElByKey.size === 0 && document.querySelectorAll('.msg-row').length === 0 && !ChatApp.msgLoadingOlder), true, 'history snapshot captured before clear cannot resurrect messages or strand loading');
        result.phases.push({ name: 'clear room removes current tail and rejects an already pending history snapshot' });
        // Exercise many history pages in both directions, then a sustained live
        // feed. The row/media/listener window must stay bounded in every phase.
        await page.evaluate(async () => {
          const messages = Object.fromEntries(Array.from({length: 1100}, (_, index) => [__roomLoadFixture.keyFor(index), { userCode:'TEST-USER', text:'Window message '+index, createdAt:Date.now()-2000000+index*1000 }]));
          await __roomLoadFixture.ref('messages/second').set(messages);
        });
        await page.waitForFunction(() => ChatApp.msgElByKey.has('k00001099'));
        for (let index = 0; index < 7; index++) {
          const windowState = await page.evaluate(async () => {
            ChatApp.stopChatBottomFollowing(); ChatApp.messagesEl.scrollTop=20;
            const anchor=ChatApp.getMessageWindowAnchor();
            await ChatApp.loadOlderMessagesPage();
            return {rows:ChatApp.msgElByKey.size, gap:ChatApp.msgHasNewerHistory, delta:anchor?.row.isConnected ? anchor.row.getBoundingClientRect().top-ChatApp.messagesEl.getBoundingClientRect().top-anchor.offset : 0};
          });
          assert.ok(windowState.rows <= 360, 'history browsing keeps at most 360 rows');
          assert.ok(Math.abs(windowState.delta)<3, 'bounded older paging preserves the visible anchor');
        }
        assert.equal(await page.evaluate(()=>ChatApp.msgHasNewerHistory),true);
        for(let index=0;index<12 && await page.evaluate(()=>ChatApp.msgHasNewerHistory);index++) {
          await page.evaluate(async()=>{ ChatApp.messagesEl.scrollTop=ChatApp.messagesEl.scrollHeight; await ChatApp.loadNewerMessagesPage(); });
          assert.ok(await page.evaluate(()=>ChatApp.msgElByKey.size<=360),'newer paging stays bounded');
        }
        await page.waitForFunction(()=>ChatApp.msgElByKey.has('k00001099')&&!ChatApp.msgHasNewerHistory);
        for(let batch=0;batch<8;batch++) {
          await page.evaluate(async batch=>{
            ChatApp.chatScrollUserReading=false;ChatApp.chatScrollFollowing=true;ChatApp.setMessagesScrollBottom();
            for(let index=1100+batch*50;index<1150+batch*50;index++) await __roomLoadFixture.ref('messages/second/'+__roomLoadFixture.keyFor(index)).set({userCode:'TEST-USER',text:'Live stress '+index,createdAt:Date.now()+index});
          },batch);
          await page.waitForFunction(key=>ChatApp.msgElByKey.has(key), 'k'+String(1149+batch*50).padStart(8,'0'));
          assert.ok(await page.evaluate(()=>ChatApp.msgElByKey.size<=360),'sustained live feed stays bounded');
        }
        const stress=await page.evaluate(()=>({rows:ChatApp.msgElByKey.size,listeners:__roomLoadFixture.activeMessageListeners().length,first:ChatApp.msgOldestKey}));
        assert.ok(stress.listeners<380,'history and evicted-key subscriptions retire with rows');
        result.phases.push({name:'7 older pages, forward paging and 400 incoming messages keep bounded DOM and listeners',...stress});
        await page.evaluate(()=>{
          ChatApp.stopChatBottomFollowing();ChatApp.trimMessageWindow('newest',240);
          __roomLoadFixture.holdNewerFinal=true;
          window.__newerCatchup=(async()=>{for(let i=0;i<12&&ChatApp.msgHasNewerHistory;i++){ChatApp.messagesEl.scrollTop=ChatApp.messagesEl.scrollHeight;await ChatApp.loadNewerMessagesPage();}})();
        });
        await page.waitForFunction(()=>__roomLoadFixture.pendingNewer()>0);
        await page.evaluate(()=>__roomLoadFixture.ref('messages/second/k00001500').set({userCode:'TEST-USER',text:'Arrived during final history page',createdAt:Date.now()+1600}));
        await page.waitForTimeout(200);
        await page.evaluate(()=>__roomLoadFixture.releaseNewer());
        await page.waitForFunction(()=>ChatApp.msgElByKey.has('k00001500')&&!ChatApp.msgHasNewerHistory);
        assert.ok(await page.evaluate(()=>ChatApp.msgElByKey.size<=360));
        result.phases.push({name:'live arrival during held final forward page is recovered without a gap'});
        const rollback=await page.evaluate(async()=>{
          const original=ChatApp.db.ref.bind(ChatApp.db),admin=ChatApp.isVinny;
          const before={ 'messages/second':__roomLoadFixture.get('messages/second'), 'rooms/second':__roomLoadFixture.get('rooms/second'), 'readReceipts/second':__roomLoadFixture.get('readReceipts/second') };
          let cleared=false;
          ChatApp.isVinny=()=>true;
          ChatApp.db.ref=(path='')=>{
            const ref=original(path),update=ref.update.bind(ref);
            if(!path) ref.update=async patch=>{
              if(!Object.hasOwn(patch,'messages/second')) return update(patch);
              await update(patch);
              await new Promise(resolve=>setTimeout(resolve,200));
              cleared=ChatApp.msgElByKey.size===0;
              await update(before);
              throw Error('PERMISSION_DENIED: simulated server rollback');
            };
            return ref;
          };
          try {await ChatApp.clearRoomMessages('second');return {rejected:false,cleared};}
          catch(error){return {rejected:/PERMISSION_DENIED/.test(error.message),cleared};}
          finally{ChatApp.db.ref=original;ChatApp.isVinny=admin;}
        });
        assert.equal(rollback.rejected,true);assert.equal(rollback.cleared,true,'optimistic clear paints immediately');
        await page.waitForFunction(()=>ChatApp.msgElByKey.has('k00001500')&&ChatApp.msgElByKey.size===60);
        result.phases.push({name:'denied atomic clear rolls back through live events and restores the current tail'});
        const final = await page.evaluate(() => ({ traces: __roomLoadFixture.traces, longTasks: window.__roomLongTasks, listeners: __roomLoadFixture.activeMessageListeners(), marks: window.__roomMarks }));
        assertBounded(final.traces);
        assert.ok(final.listeners.every(listener => listener.path === 'messages/second' || listener.path.startsWith('messages/second/') || listener.query?.limitToLast === 120 && ['child_added','value'].includes(listener.event)), 'old room history listeners detach; only bounded account-wide notification listeners remain');
        assert.deepEqual(errors, []);
        result.passed = true; result.queryTraces = final.traces; result.timings = final.marks;
        result.longTasks = final.longTasks; result.activeMessageListeners = final.listeners; result.errors = errors;
        console.log(`${mode}: bounded cold/warm load, history, eviction, live changes, navigation race and clear passed.`);
      } catch (error) {
        result.passed = false; result.failure = error.stack; result.errors = errors;
        result.state = await page.evaluate(() => ({ currentRoom: ChatApp.currentRoomId, user: ChatApp.currentUser, activeChat: ChatApp.views.chat.dataset.active, memberships: [...ChatApp.membershipMap], loginError: document.querySelector('#login-error')?.textContent, toast: document.querySelector('#toast')?.textContent, writes: __roomLoadFixture.writes.slice(-30), place: ChatApp.getStoredPlace(), bulk: ChatApp.bulkLoading, rows: ChatApp.msgElByKey.size, oldest: ChatApp.msgOldestKey, traces: __roomLoadFixture.traces, marks: window.__roomMarks })).catch(() => null);
        throw error;
      } finally {
        fs.writeFileSync(path.join(reportDirectory, 'room-loading-report.json'), JSON.stringify(results, null, 2));
        await context.close();
      }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
