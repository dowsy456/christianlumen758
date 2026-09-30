'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');
(async () => {
  const qaRoot = path.resolve(__dirname, '../../../release-native-qa');
  await fs.mkdir(qaRoot, { recursive:true });
  const profile = await fs.mkdtemp(path.join(qaRoot, 'profile-'));
  const env = { ...process.env, CHAT_APP_TEST_PROFILE:profile, CHAT_APP_OFFLINE:'1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await electron.launch({ executablePath: process.env.CHAT_APP_TEST_EXECUTABLE || require('../node_modules/electron'), args: process.env.CHAT_APP_TEST_EXECUTABLE ? [] : [path.resolve(__dirname, '..')], env });
    // Isolated offline QA grants the application's media permission prompt.
    // No microphone/camera is opened; the selected screen stream is stopped below.
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response:0 }); });
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      ready = await application.evaluate(async ({ webContents }) => {
        globalThis.__appContents = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('chatapp://app/'));
        return __appContents && await __appContents.executeJavaScript('document.documentElement.dataset.appReady === "true"');
      });
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'real native application loads bundled shared source');
    const snapshot = await application.evaluate(async ({ app, BrowserWindow }) => {
      globalThis.__main = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'Chat App');
      globalThis.__badges = [];
      const original = __main.setOverlayIcon.bind(__main);
      __main.setOverlayIcon = (icon, description) => { __badges.push({ description, size:icon?.getSize() || null }); return original(icon, description); };
      const source = await __appContents.executeJavaScript(`({version: ChatRuntime.version, notifications:!!window.chatDesktopNotifications, spotify:!!window.chatDesktopSpotify, clipboard:!!window.chatDesktopClipboard, maxFiles:ChatApp.CHAT_FILE_MAX_COUNT, effects:Object.keys(ChatApp.soundEffectCatalog)})`);
      return { nativeVersion:app.getVersion(), ...source };
    });
    assert.equal(snapshot.nativeVersion, require('../package.json').version);
    assert.equal(snapshot.version, require('../../build-info.json').assetRevision);
    assert.equal(snapshot.notifications && snapshot.spotify && snapshot.clipboard, true);
    assert.equal(snapshot.maxFiles, 12); assert.equal(snapshot.effects.length, 10);
    await application.evaluate(async () => { await __appContents.executeJavaScript('chatDesktopNotifications.setUnreadCount(3)'); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await application.evaluate(() => __badges.at(-1)), { description:'3 unread messages', size:{width:32,height:32} });
    await application.evaluate(async () => { await __appContents.executeJavaScript('chatDesktopNotifications.setUnreadCount(0)'); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await application.evaluate(() => __badges.at(-1).size), null);
    const spotify = await application.evaluate(async () => __appContents.executeJavaScript('chatDesktopSpotify.getState()'));
    assert.equal(spotify.configured, true); assert.equal(spotify.connected, false);
    assert.equal('accessToken' in spotify, false);
    const capture = await application.evaluate(async ({ BrowserWindow }) => {
      __main.restore(); __main.show(); __main.focus();
      const before = BrowserWindow.getAllWindows().length;
      const result = await __appContents.executeJavaScript(`(async () => {
        if (chatDesktopCapture.version !== 1) throw Error('Missing capture bridge');
        const invalid = await chatDesktopCapture.selectSource('screen:missing:invalid');
        const sources = await chatDesktopCapture.listSources({ fresh: true });
        const source = sources.find(item => item.id.startsWith('screen:'));
        if (!source) throw Error('No native monitor found');
        const selected = await chatDesktopCapture.selectSource(source.id);
        if (!selected) throw Error('Source selection rejected');
        const request = navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal:1280, max:1280 }, height: { ideal:720, max:720 }, frameRate: { ideal:30, max:30 } }, audio:false });
        const stream = await Promise.race([request, new Promise((_, reject) => setTimeout(() => reject(Error('Native screen capture timed out')), 15000))]);
        const settings = stream.getVideoTracks()[0].getSettings();
        stream.getTracks().forEach(track => track.stop());
        return { invalid, sourceCount:sources.length, settings };
      })()`, true);
      return { ...result, before, after:BrowserWindow.getAllWindows().length };
    });
    assert.equal(capture.invalid, false, 'an arbitrary native source ID is rejected');
    assert.equal(capture.before, capture.after, 'in-app source selection creates no picker window');
    assert.ok(capture.settings.width <= 1280 && capture.settings.height <= 720);
    assert.ok(capture.settings.frameRate <= 30);
    console.log('Native release passed: versions, shared web boot, 12 files, ten effects, real unread IPC/Windows overlay, Spotify configuration and isolated offline profile.');
    console.log('Native in-app capture passed: source enumeration, invalid ID rejection, selected monitor capture <=720p30, no secondary picker window, immediate track cleanup.');
  } finally {
    if (application) await application.close();
    assert.ok(path.resolve(profile).startsWith(qaRoot + path.sep));
    await fs.rm(profile, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
