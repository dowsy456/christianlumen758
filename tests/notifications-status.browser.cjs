'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const installFirebaseMock = require('./firebase-mock.js');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    for (const desktop of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addInitScript(installFirebaseMock);
      await context.addInitScript(desktop => {
        if (desktop) window.chatDesktopOverlay = { version: 1, publish() {} };
        window.__notices = [];
        window.Notification = class {
          static permission = 'granted';
          constructor(title, options) { window.__notices.push({ title, options }); }
        };
      }, desktop);
      await context.route(/^https?:\/\//, route => route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'null' }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await page.click('#btn-go-login'); await page.fill('#login-code','TEST-USER'); await page.click('#btn-login');
      await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER' && ChatApp.membershipMap.has('test'));
      await page.evaluate(async () => {
        window.__sounds = [];
        ChatApp.playNotificationSound = name => { if (!ChatApp.isDoNotDisturb()) __sounds.push(name); };
        ChatApp.pushNotifsEnabled = true;
        await ChatApp.db.ref('rooms/other').set({ name:'Other room', createdBy:'TEST-USER' });
        await ChatApp.db.ref('messages/other/history').set({ userCode:'PEER',username:'Friend',text:'old',createdAt:1 });
        await ChatApp.db.ref('memberships/TEST-USER/other').set(true);
      });
      await page.waitForFunction(() => ChatApp.membershipMap.has('other'));
      await page.waitForTimeout(50);
      assert.deepEqual(await page.evaluate(() => __sounds), []);
      await page.evaluate(async () => {
        await ChatApp.db.ref('messages/test/one').set({ userCode:'PEER',username:'Friend',text:'hi',createdAt:Date.now() });
        await ChatApp.db.ref('messages/other/two').set({ userCode:'PEER',username:'Friend',text:'@Tester hi',createdAt:Date.now() });
        await ChatApp.db.ref('pings/TEST-USER/other/ping').set({ from:'PEER',fromUsername:'Friend',msgKey:'two',at:Date.now() });
      });
      await page.waitForFunction(() => __sounds.length === 2 && __notices.length === 1);
      assert.deepEqual(await page.evaluate(() => __sounds), ['Message','Ping']);
      await page.locator('.me-pill-dock').click();
      const avatar = page.locator('#user-profile-card .user-profile-avatar');
      await avatar.waitFor({ state:'visible' });
      await avatar.click();
      if (desktop) {
        const menu = page.locator('#profile-status-menu');
        await menu.waitFor({ state:'visible' });
        await page.waitForTimeout(180); await page.screenshot({ path: path.resolve(__dirname, '../../status-menu.png') });
        assert.equal(await menu.locator('button').count(), 2);
        await menu.getByRole('menuitemradio', { name:'Do Not Disturb' }).click();
        await page.waitForFunction(() => __testDatabase.get('users/TEST-USER/notificationStatus') === 'dnd');
        assert.equal(await page.locator('.user-profile-presence').innerText(), 'Do Not Disturb');
        assert.equal(await page.locator('.user-profile-presence').evaluate(el => getComputedStyle(el,'::before').backgroundColor), 'rgb(239, 91, 102)');
        await page.evaluate(() => { ChatApp.myRoomIdle = true; ChatApp.lastAppInputAt = 0; ChatApp.syncAppIdle(); ChatApp.refreshOpenUserProfilePresence(); });
        assert.equal(await page.locator('.user-profile-presence').innerText(), 'Do Not Disturb');
      } else {
        assert.equal(await page.locator('#profile-status-menu').count(), 0, 'web has no status menu');
        await page.evaluate(() => ChatApp.db.ref('users/TEST-USER/notificationStatus').set('dnd'));
        await page.waitForFunction(() => ChatApp.isDoNotDisturb());
      }
      await page.evaluate(async () => {
        await ChatApp.db.ref('messages/other/three').set({ userCode:'PEER',username:'Friend',text:'@Tester DND',createdAt:Date.now() });
        await ChatApp.db.ref('messages/other/four').set({ userCode:'PEER',username:'Friend',text:'silent regular',createdAt:Date.now() });
      });
      await page.waitForFunction(() => __notices.length === 2);
      assert.equal(await page.evaluate(() => __sounds.length), 2, 'DND sounds remain silent in web and desktop');
      assert.ok(await page.evaluate(() => __notices.every(notice => notice.options.silent)));
      if (desktop) {
        await avatar.click();
        await page.getByRole('menuitemradio', { name:'Online', exact:true }).click();
        await page.waitForFunction(() => __testDatabase.get('users/TEST-USER/notificationStatus') === 'online');
        assert.equal(await page.locator('.user-profile-presence').innerText(), 'Online');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Notifications/status browser: joined-room sound routing, ping deduplication, desktop status menu, Firebase sync, idle persistence, web DND and notification policy passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
