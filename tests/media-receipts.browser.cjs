/* Browser regressions use the local in-memory database; all remote requests are stubbed. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const mock = require('./firebase-mock.js');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(mock);
    await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'null' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.click('#btn-go-login');
    await page.fill('#login-code', 'TEST-USER');
    await page.click('#btn-login');
    await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER');
    await page.evaluate(async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#79c"/></svg>';
      window.__mediaData = 'data:image/svg+xml;base64,' + btoa(svg);
      await __testDatabase.ref('users/AUTHOR').set({ code: 'AUTHOR', username: 'BrognatheLongDisplayName', displayName: 'BrognatheLongDisplayName' });
      await __testDatabase.ref('messages/test/media').set({ userCode: 'AUTHOR', username: 'BrognatheLongDisplayName', createdAt: Date.now(), files: [{ kind: 'image', dataURL: __mediaData, fileName: 'test.svg' }] });
      await __testDatabase.ref('readReceipts/test/media').set({ ALICE: 1, BOB: 1 });
      await ChatApp.openRoom('test', { quiet: true });
    });
    await page.waitForFunction(() => !ChatApp.bulkLoading && ChatApp.readReceiptState?.key === 'media');
    await page.waitForSelector('.message-seen-avatar[data-usercode="ALICE"]');
    const geometry = await page.evaluate(() => {
      const name = document.querySelector('.bubble-name');
      const time = document.querySelector('.bubble-time').getBoundingClientRect();
      const seen = document.querySelector('.message-seen').getBoundingClientRect();
      const avatars = [...document.querySelectorAll('.message-seen-avatar')].map(el => el.getBoundingClientRect());
      return { nameFits: name.scrollWidth <= name.clientWidth, sameLine: seen.y < time.bottom && seen.bottom > time.y, avatarRow: avatars.every(r => Math.abs(r.y - avatars[0].y) < 1) };
    });
    assert.deepEqual(geometry, { nameFits: true, sameLine: true, avatarRow: true }, 'gallery dimensions cannot compress message metadata');
    await page.locator('.bubble-time').hover();
    await page.locator('#timestamp-tooltip').waitFor({state:'visible'});
    await page.mouse.move(5,5);
    await page.locator('#timestamp-tooltip').waitFor({state:'hidden'});
    // A replaced timestamp may disappear without ever emitting pointerleave.
    await page.evaluate(() => {
      const time = document.querySelector('.bubble-time').cloneNode(true);
      document.body.appendChild(time);
      ChatApp.showTimestampTooltipFor(time);
      time.remove();
    });
    await page.locator('#timestamp-tooltip').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => ChatApp.activeTimestampTooltipTarget), null, 'detached timestamps cannot retain their tooltip');
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), true, 'uncovered attachment is visible');
    const contentVisibility = await page.evaluate(() => {
      const item = document.querySelector('.att-item');
      const before = item.style.cssText;
      item.style.visibility = 'hidden';
      const invisible = ChatApp.canSeeLatestMessage();
      item.style.cssText = before;
      item.style.transform = 'translateY(2000px)';
      const offscreen = ChatApp.canSeeLatestMessage();
      item.style.cssText = before;
      return { invisible, offscreen };
    });
    assert.deepEqual(contentVisibility, { invisible: false, offscreen: false }, 'a visible author header alone is insufficient');

    // An arbitrary covering surface, including one outside the chat DOM.
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'fixture-occluder';
      overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483646';
      document.body.appendChild(overlay);
    });
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, 'covered message is not read');
    await page.evaluate(() => { document.querySelector('#fixture-occluder').style.pointerEvents = 'none'; });
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, 'visual overlay still blocks even with pointer events disabled');
    await page.evaluate(() => document.querySelector('#fixture-occluder').remove());

    // Blackout is attached to <html>, outside <body>, and is aria-hidden.
    await page.keyboard.press('Shift+Z');
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, 'blackout never counts as a read');
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Z');
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), true);
    await page.evaluate(() => ChatApp.openModal({ title: 'Fixture Modal', bodyHTML: '<p>Message covered</p>' }));
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, 'modal blocks reading');
    await page.evaluate(() => ChatApp.closeModal());

    // Receipt timers must be cancelled while the UI obstructs the message.
    await page.evaluate(async () => {
      const cover = document.createElement('div'); cover.id = 'fixture-cover';
      cover.style.cssText = 'position:fixed;inset:0;background:#123;z-index:2147483646'; document.body.appendChild(cover);
      await __testDatabase.ref('messages/test/newest').set({ userCode: 'AUTHOR', username: 'BrognatheLongDisplayName', createdAt: Date.now() + 1, text: 'Read this only while it is visible.' });
    });
    await page.waitForFunction(() => ChatApp.readReceiptState?.key === 'newest');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => !!ChatApp.readReceiptState.receipts['TEST-USER']), false, 'new message behind an overlay cannot accrue a read');
    await page.evaluate(() => document.querySelector('#fixture-cover').remove());
    await page.waitForFunction(() => !!ChatApp.readReceiptState.receipts['TEST-USER']);
    const completedReceipt = await page.evaluate(() => {
      const original = ChatApp.canSeeLatestMessage;
      let visibilityChecks = 0;
      ChatApp.canSeeLatestMessage = () => { visibilityChecks++; return original(); };
      ChatApp.readReceiptTimer = setTimeout(() => { throw new Error('Stale receipt timer was not cancelled'); }, 100);
      ChatApp.scheduleReceiptRead();
      ChatApp.canSeeLatestMessage = original;
      return { visibilityChecks, timer: ChatApp.readReceiptTimer };
    });
    assert.deepEqual(completedReceipt, { visibilityChecks: 0, timer: null }, 'completed receipts skip geometry and cancel stale timers');

    const state = await page.evaluate(() => {
      const mode = document.body.dataset;
      mode.activityMode = '1'; mode.activityChat = '0';
      const activityHidden = ChatApp.canSeeLatestMessage();
      mode.activityMode = '0'; mode.callChatMode = '1'; mode.callChat = '0';
      const callHidden = ChatApp.canSeeLatestMessage();
      mode.callChatMode = '0'; mode.companionChat = '1'; mode.membersSidebar = '1';
      const membersHidden = ChatApp.canSeeLatestMessage();
      mode.companionChat = '0'; mode.membersSidebar = '0';
      return { activityHidden, callHidden, membersHidden };
    });
    assert.deepEqual(state, { activityHidden: false, callHidden: false, membersHidden: false });

    // Exercise real activity chrome: its full-screen, pointer-transparent
    // backdrop paints below the companion, so geometry alone is insufficient.
    await page.evaluate(() => ChatApp.openMergePartyActivity('test'));
    await page.waitForFunction(() => document.querySelector('#games-frame')?.contentWindow?.__mergeParty);
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, 'full activity hides chat');
    for (const side of ['left', 'right']) {
      await page.evaluate(side => {
        ChatApp.applySidebarPosition(side);
        ChatApp.setActivityChatOpen(true);
        ChatApp.messagesEl.scrollTop = ChatApp.messagesEl.scrollHeight;
      }, side);
      await page.waitForFunction(() => ChatApp.canSeeLatestMessage());
      assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), true, `${side} activity chat paints above its backdrop`);
      await page.evaluate(() => ChatApp.setActivityChatOpen(false));
      assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, `${side} closed activity chat is unreadable`);
    }
    await page.evaluate(() => ChatApp.closeGamesStage({ preserve: false }));
    await page.waitForFunction(() => !ChatApp.gamesStageOpen);

    await page.evaluate(() => {
      ChatApp.currentCallRoomId = 'test';
      ChatApp.openCallMenu();
      ChatApp.setCallMenuExpanded(true);
    });
    assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, 'expanded call covers normal chat');
    for (const side of ['left', 'right']) {
      await page.evaluate(async side => {
        ChatApp.applySidebarPosition(side);
        await ChatApp.toggleExpandedCallChat();
        ChatApp.messagesEl.scrollTop = ChatApp.messagesEl.scrollHeight;
      }, side);
      await page.waitForFunction(() => ChatApp.canSeeLatestMessage());
      assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), true, `${side} expanded call companion can be read`);
      await page.evaluate(() => ChatApp.toggleExpandedCallChat());
      assert.equal(await page.evaluate(() => ChatApp.canSeeLatestMessage()), false, `${side} closed call chat is unreadable`);
    }
    await page.evaluate(() => { ChatApp.closeCallMenu(); ChatApp.currentCallRoomId = null; });

    // Shared cached metadata comes in before this older history row is mounted.
    await page.evaluate(async () => {
      const meta = { id: 'old', name: 'Old Sticker', kind: 'image', state: 'ready', mimeType: 'image/svg+xml' };
      await __testDatabase.ref('stickers/meta/old').set(meta);
      await __testDatabase.ref('stickers/assets/old').set({ dataURL: __mediaData, dataChunkCount: 1 });
      window.__stickerOff = ChatApp.watchStickerMeta('old', () => {});
      await new Promise(resolve => setTimeout(resolve, 10));
      const fragment = document.createDocumentFragment();
      ChatApp.appendMessageRow({ _key: 'old-sticker', userCode: 'AUTHOR', createdAt: Date.now() + 2, sticker: meta }, { target: fragment, suppressScroll: true });
      await new Promise(resolve => setTimeout(resolve, 30));
      ChatApp.messagesListEl.appendChild(fragment);
      ChatApp.messagesEl.scrollTop = ChatApp.messagesEl.scrollHeight;
    });
    await page.waitForFunction(() => document.querySelector('[data-msgkey="old-sticker"] .sticker-message img')?.naturalWidth > 0);
    await page.evaluate(() => __stickerOff());
    await page.evaluate(() => ChatApp.openMediaModal('image', __mediaData, { fileName: 'fixture.svg' }));
    await page.waitForSelector('#btn-media-create-sticker:not([hidden])');
    const order = await page.evaluate(() => document.querySelector('#btn-media-create-sticker').getBoundingClientRect().x < document.querySelector('#btn-modal-close').getBoundingClientRect().x);
    assert.equal(order, true, 'Create Sticker precedes Close in the media viewer');
    assert.deepEqual(errors, []);
    console.log('Media/receipts passed: gallery header, mounted history stickers, cloak/modals/passive overlays, visibility dwell, actual Merge/call companions on both sides, and viewer action order.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
