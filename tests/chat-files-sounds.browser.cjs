/* Real chat geometry, file transfer events, Firebase prefs and taskbar totals. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const installFirebaseMock = require('./firebase-mock.js');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    for (const desktop of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addInitScript(installFirebaseMock);
      await context.addInitScript(desktop => {
        const messages = {};
        for (let i = 0; i < 60; i++) messages[`old-${String(i).padStart(3,'0')}`] = { userCode: 'peer', username: 'Peer', text: `Older message ${i}. ` + 'Read the message content. '.repeat(3), createdAt: 1000 + i };
        __testDatabase.values.messages = { test: messages };
        __testDatabase.values.rooms.test.messageCount = 60;
        __testDatabase.values.memberships['TEST-USER'].test = { joinedAt: 1, lastSeenCount: 0 };
        window.__badges = [];
        if (desktop) {
          window.chatDesktopNotifications = { setUnreadCount: count => __badges.push(count) };
          window.chatDesktopClipboard = { readFiles: async () => [{ name: 'explorer.txt', type: 'text/plain', data: new TextEncoder().encode('from Explorer').buffer }] };
        }
      }, desktop);
      await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'null' }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await page.click('#btn-go-login'); await page.fill('#login-code', 'TEST-USER'); await page.click('#btn-login');
      await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER');
      await page.evaluate(() => ChatApp.openRoom('test', { quiet: true }));
      await page.waitForFunction(() => !ChatApp.bulkLoading && ChatApp.msgDataByKey.size === 60 && ChatApp.canSeeMessage('test', 'old-059'));
      await page.evaluate(() => { ChatApp.closeToast(); window.__sounds = []; ChatApp.playNotificationSound = name => __sounds.push(name); });
      async function incoming(key, text = 'Incoming message', userCode = 'peer') {
        await page.evaluate(async ({key,text,userCode}) => {
          await ChatApp.db.ref(`messages/test/${key}`).set({ userCode, username: 'Peer', text, createdAt: Date.now() });
          if (userCode === 'TEST-USER') await ChatApp.updateRoomLastMessage('test', text, key, userCode);
          else await ChatApp.db.ref('rooms/test/messageCount').transaction(n => n + 1);
        }, {key,text,userCode});
        await page.waitForTimeout(220);
      }
      await incoming('visible', '@Tester visible message');
      assert.deepEqual(await page.evaluate(() => __sounds), [], 'visible incoming ping is silent');
      await page.evaluate(() => { ChatApp.roomEntryScroll = null; ChatApp.chatScrollFollowing = false; ChatApp.chatScrollUserReading = true; ChatApp.messagesEl.scrollTop = 0; });
      await incoming('offscreen');
      assert.deepEqual(await page.evaluate(() => __sounds), ['Message'], 'offscreen message in current room alerts');
      assert.equal(await page.evaluate(() => ChatApp.getRoomMissedCount('test')), 1, 'unread room remains unread while scrolled up');
      await incoming('offscreen-ping', '@Tester offscreen');
      assert.deepEqual(await page.evaluate(() => __sounds), ['Message', 'Ping']);
      await incoming('self', 'My message', 'TEST-USER');
      assert.deepEqual(await page.evaluate(() => __sounds), ['Message', 'Ping'], 'own messages never alert');
      assert.equal(await page.evaluate(() => ChatApp.getRoomMissedCount('test')), 2, 'own messages do not add unread or clear unseen peers');
      await page.evaluate(() => ChatApp.creditOwnMessageRead('test', 'self', 'TEST-USER', 64));
      assert.equal(await page.evaluate(() => ChatApp.getRoomMissedCount('test')), 2, 'own read credit is idempotent');
      if (desktop) assert.ok((await page.evaluate(() => __badges)).includes(2), 'badge counts messages, not rooms');
      await page.evaluate(() => { ChatApp.messagesEl.scrollTop = ChatApp.messagesEl.scrollHeight; ChatApp.queueReadReceiptSync(); });
      await page.waitForFunction(() => ChatApp.getRoomMissedCount('test') === 0);

      // The file chooser, drag/drop, paste and direct additions share one cap.
      await page.locator('#file-input').setInputFiles(Array.from({length:13}, (_,i) => ({name:`file-${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('contents')})));
      await page.waitForFunction(() => ChatApp.pendingFiles.length === 12);
      assert.equal(await page.evaluate(async () => ChatApp.addPendingFile(new File(['extra'],'extra.txt'))), false);
      assert.match(await page.locator('#files-bar-limit').textContent(), /12\/12 files/);
      await page.evaluate(() => {
        ChatApp.clearPendingFiles();
        const data = new DataTransfer(); data.items.add(new File(['pasted'], 'clipboard.txt', {type:'text/plain'}));
        document.getElementById('msg-input').dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:data}));
      });
      await page.waitForFunction(() => ChatApp.pendingFiles[0]?.name === 'clipboard.txt');
      await page.evaluate(() => {
        ChatApp.clearPendingFiles();
        const data = new DataTransfer(); for (let i=0;i<14;i++) data.items.add(new File(['drop'], `drop-${i}.txt`));
        document.getElementById('messages').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:data}));
      });
      await page.waitForFunction(() => ChatApp.pendingFiles.length === 12);
      assert.equal(await page.evaluate(async () => { ChatApp.clearPendingFiles(); return ChatApp.addPendingFile({name:'too-large.zip',size:ChatApp.CHAT_FILE_MAX_BYTES+1}); }), false);
      assert.equal(await page.evaluate(async () => { try { await ChatApp.writeMessageAttachmentsToRef({}, Array(13).fill({})); return false; } catch { return true; } }), true);
      if (desktop) {
        await page.evaluate(() => document.getElementById('msg-input').dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:new DataTransfer()})));
        await page.waitForFunction(() => ChatApp.pendingFiles[0]?.name === 'explorer.txt');
      }
      await page.evaluate(() => { ChatApp.clearPendingFiles(); ChatApp.closeToast(); });
      await page.click('#btn-side-settings'); await page.click('#settings-tab-preferences');
      await page.click('#settings-sound-effects-details');
      assert.equal(await page.locator('[data-sound-effect]').count(), 10);
      assert.equal(await page.locator('[data-sound-effect]:checked').count(), 10);
      await incoming('behind-settings', '@Tester behind settings');
      assert.equal((await page.evaluate(() => __sounds)).at(-1), 'Ping', 'covered current-room message alerts');
      await page.locator('label:has(#settings-sound-startwatching)').click();
      await page.waitForFunction(() => __testDatabase.get('users/TEST-USER/settings/soundEffects/startwatching') === false);
      assert.equal(await page.evaluate(() => ChatApp.isSoundEffectEnabled('StartWatching')), false);
      await page.locator('label:has(#settings-sound-effects)').click();
      await page.waitForFunction(() => __testDatabase.get('users/TEST-USER/settings/soundEffectsEnabled') === false);
      assert.equal(await page.evaluate(() => ChatApp.isSoundEffectEnabled('Message')), false);
      const stored = await page.evaluate(async () => {
        const settings = await ChatApp.loadSettingsForUser('TEST-USER');
        ChatApp.applyResolvedSettings(settings);
        return { enabled: settings.soundEffectsEnabled, watching: settings.soundEffects.startwatching, count: Object.keys(settings.soundEffects).length };
      });
      assert.deepEqual(stored, {enabled:false,watching:false,count:10});
      await page.evaluate(() => ChatApp.closeModal());
      await page.evaluate(async () => {
        await ChatApp.db.ref('rooms/other').set({name:'Other',messageCount:5});
        await ChatApp.db.ref('memberships/TEST-USER/other').set({joinedAt:1,lastSeenCount:2});
        await ChatApp.db.ref('rooms/third').set({name:'Third',messageCount:6});
        await ChatApp.db.ref('memberships/TEST-USER/third').set({joinedAt:1,lastSeenCount:2});
      });
      await page.waitForFunction(() => ChatApp.syncUnreadTaskbarBadge() === 7);
      if (desktop) assert.equal(await page.evaluate(() => __badges.at(-1)), 7);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Chat files/sounds passed for web and desktop: visible/hidden/own message sounds, 12-file cap, chooser/drop/paste/Explorer, size/send guard, ten Firebase sound preferences, total unread badge.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
