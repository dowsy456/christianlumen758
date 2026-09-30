'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright');
(async () => {
  const testRoot = path.resolve(__dirname, '../../../native-rings-qa'); await fs.mkdir(testRoot, { recursive: true });
  const profile = await fs.mkdtemp(path.join(testRoot, 'profile-'));
  const env = { ...process.env, CHAT_APP_TEST_PROFILE: profile, CHAT_APP_OFFLINE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const until = async (read, label) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await read(); if (value) return value; await delay(75); } throw new Error('Timed out: ' + label); };
  try {
    app = await electron.launch({ executablePath: process.env.CHAT_APP_TEST_EXECUTABLE || require('../node_modules/electron'), args: process.env.CHAT_APP_TEST_EXECUTABLE ? [] : [path.join(__dirname, 'fixtures/overlay-offline.cjs')], env });
    await until(() => app.evaluate(async ({ webContents }) => { const content = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('chatapp://app/')); return content && await content.executeJavaScript('!!window.chatDesktopRings && document.documentElement.dataset.appReady === "true"'); }), 'app loads with actual bridge');
    await app.evaluate(({ app, BrowserWindow, webContents, screen }) => {
      globalThis.__main = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'Chat App');
      globalThis.__contents = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('chatapp://app/'));
      globalThis.__mouseModes = [];
      globalThis.__cursor = {x:0,y:0}; screen.getCursorScreenPoint = () => __cursor;
      app.on('browser-window-created', (_event, win) => {
        if (win.getTitle() !== 'Chat App Incoming Calls') return;
        const setIgnore = win.setIgnoreMouseEvents.bind(win);
        win.setIgnoreMouseEvents = (value, options) => { __mouseModes.push(value); setIgnore(value, options); };
      });
      __main.minimize();
    });
    const icon = title => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="20" fill="#426b8b"/><text x="40" y="54" text-anchor="middle" font-size="42" font-family="sans-serif" fill="white">${title}</text></svg>`);
    const rings = ['Evening Games', 'Study Group', 'Friends'].map((roomName, i) => ({ id: 'ring-' + i, roomId: 'room-' + i, roomName, roomIcon: icon(String(i + 1)), roomIconTransform: { x: 0, y: 0, scale: 1 }, expiresAt: Date.now() + 30000 }));
    const publish = rings => app.evaluate(async (_electron, rings) => __contents.executeJavaScript(`chatDesktopRings.publish(${JSON.stringify({ rings })})`), rings);
    await publish(rings);
    await until(() => app.evaluate(({ BrowserWindow }) => { globalThis.__popup = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'Chat App Incoming Calls'); return __popup?.isVisible(); }), 'native popup shows independently');
    const popupPage = await until(() => app.windows().find(page => page.url().endsWith('/rings.html')), 'popup page');
    // Use a deterministic cursor without moving the user's physical mouse.
    assert.deepEqual(await app.evaluate(() => __mouseModes), [true]);
    assert.equal(await app.evaluate(() => __popup.isFocusable()), true);
    assert.equal(await app.evaluate(() => __popup.isFocused()), false, 'incoming calls appear without stealing focus');
    await delay(300);
    const hover = async selector => {
      const point = selector ? await popupPage.locator(selector).first().evaluate(element => { const r=element.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; }) : {x:-100,y:-100};
      await app.evaluate((_electron, point) => { const b=__popup.getBounds(); __cursor={x:b.x+point.x,y:b.y+point.y}; }, point);
      await delay(190);
    };
    await hover('.name');
    assert.equal(await popupPage.locator('.ring').first().evaluate(e=>Number(getComputedStyle(e).opacity)), .3);
    assert.equal(await app.evaluate(() => __mouseModes.at(-1)), true);
    await hover('.join');
    assert.equal(await popupPage.locator('.ring').first().evaluate(e=>Number(getComputedStyle(e).opacity)), 1);
    assert.equal(await app.evaluate(() => __mouseModes.at(-1)), false);
    await hover(null);
    assert.equal(await popupPage.locator('.ring').first().evaluate(e=>Number(getComputedStyle(e).opacity)), 1);
    assert.equal(await app.evaluate(() => __mouseModes.at(-1)), true);
    const dimensions = await app.evaluate(async () => __popup.webContents.executeJavaScript(`({names:[...document.querySelectorAll('.name')].map(x=>x.textContent),buttons:[...document.querySelectorAll('.control')].map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height})),height:document.getElementById('rings').getBoundingClientRect().height})`));
    assert.deepEqual(dimensions.names, rings.map(ring => ring.roomName)); assert.equal(dimensions.buttons.length, 6); assert.ok(dimensions.buttons.every(b => b.width === 54 && b.height === 44)); assert.ok(dimensions.height <= 552);
    assert.deepEqual(await popupPage.evaluate(() => ({ horizontal: getComputedStyle(document.getElementById('rings')).overflowX, scrollbar: getComputedStyle(document.getElementById('rings')).scrollbarWidth })), { horizontal: 'hidden', scrollbar: 'none' });
    await popupPage.locator('.ring').first().hover();
    assert.equal(await popupPage.locator('.ring').first().evaluate(el => getComputedStyle(el).opacity), '1');
    const screenshot = await app.evaluate(async () => (await __popup.webContents.capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(testRoot, 'incoming-rings.png'), Buffer.from(screenshot, 'base64'));
    rings[0].roomName = 'Live Room Rename'; await publish(rings); await delay(70);
    assert.equal(await app.evaluate(async () => __popup.webContents.executeJavaScript('document.querySelector(".name").textContent')), 'Live Room Rename');
    const oldHeight = await app.evaluate(() => __popup.getBounds().height); await publish(rings.slice(0, 1)); await delay(60);
    assert.equal(await app.evaluate(() => __popup.getBounds().height), oldHeight, 'surface remains tall for fade');
    await delay(250); assert.ok(await app.evaluate(() => __popup.getBounds().height) < oldHeight);
    await app.evaluate(async () => __contents.executeJavaScript('window.__ringCommands=[];chatDesktopRings.onCommand(x=>{__ringCommands.push(x);chatDesktopRings.publish({rings:[]});});true'));
    await hover('.decline'); await popupPage.locator('.decline').click();
    await delay(80); assert.equal(await app.evaluate(async () => __contents.executeJavaScript('__ringCommands[0]?.action')), 'decline');
    await delay(250); assert.equal(await app.evaluate(() => __popup.isVisible()), false);
    await publish([{ ...rings[0], id: 'join-test', expiresAt: Date.now() + 30000 }]); await delay(250);
    await hover('.join'); await popupPage.locator('.join').click();
    await until(() => app.evaluate(async () => __contents.executeJavaScript('__ringCommands.at(-1)?.action === "join"')), 'join pointer command');
    assert.equal(await app.evaluate(() => __main.isMinimized()), false, 'Join restores the app window');
    assert.ok((await app.evaluate(() => __mouseModes)).includes(false));
    console.log('Native rings passed: opacity 100/30/100, native body click-through and button hit testing, Decline/Join IPC, no unsolicited focus, app restore, stacked controls and graceful removal. Screenshot: ' + path.join(testRoot, 'incoming-rings.png'));
  } finally { if (app) await app.close(); assert.ok(path.resolve(profile).startsWith(testRoot + path.sep)); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
