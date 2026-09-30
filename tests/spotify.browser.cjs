'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const firebaseMock = require('./firebase-mock.js');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    for (const desktop of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
      await context.addInitScript(firebaseMock);
      if (desktop) await context.addInitScript(() => {
        let state = { accountCode: '', configured: true, connected: false, connecting: false, track: null, error: '' }, change;
        window.__spotifyOpened = [];
        window.__spotifyTrack = { id: '1234567890abcdefghijkl', title: 'A Long Song Name', artist: 'Test Artist', album: 'Test Album', image: 'https://i.scdn.co/image/cover' };
        window.chatDesktopSpotify = { setUser: async code => (state = { ...state, accountCode: code }), getState: async () => state, onChange: callback => { change = callback; }, connect: async () => { state = { ...state, connected: true, track: __spotifyTrack }; change(state); return state; }, disconnect: async () => { state = { ...state, connected: false, track: null }; change(state); return state; }, openTrack: async id => __spotifyOpened.push(id) };
      });
      await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'null' }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await page.click('#btn-go-login'); await page.fill('#login-code', 'TEST-USER'); await page.click('#btn-login');
      await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER');
      await page.evaluate(() => ChatApp.openRoom('test', { quiet: true }));
      await page.waitForFunction(() => ChatApp.currentRoomId === 'test' && !ChatApp.bulkLoading);
      await page.evaluate(() => document.querySelector('#btn-side-settings').click());
      await page.click('#settings-tab-account');
      if (desktop) {
        await page.locator('#settings-spotify-connect').click();
        await page.waitForFunction(() => Object.values(__testDatabase.get('users/TEST-USER/spotifySessions') || {}).some(session => session.track?.title === 'A Long Song Name'));
        assert.equal(await page.locator('#settings-spotify-disconnect').isVisible(), true);
        await page.evaluate(() => ChatApp.closeModal());
      } else {
        assert.equal(await page.locator('#settings-spotify-connect').count(), 0, 'web cannot connect Spotify');
        await page.evaluate(async () => { ChatApp.closeModal(); await ChatApp.db.ref('users/TEST-USER/spotifySessions/remote-desktop').set({ track: { id: '1234567890abcdefghijkl', title: 'A Long Song Name', artist: 'Test Artist', album: 'Test Album', image: 'https://i.scdn.co/image/cover' }, updatedAt: Date.now() }); });
      }
      await page.waitForFunction(() => ChatApp.getUserSpotifyTrack(ChatApp.currentUser)?.title === 'A Long Song Name');
      await page.evaluate(() => {
        ChatApp.getClassNameAtTimestamp = () => 'Mathematics';
        if (document.body.dataset.membersSidebar !== '1') ChatApp.toggleMembersListVisibility();
        ChatApp.renderOnlineIndicator();
      });
      const row = page.locator('.members-sidebar .member-row[data-usercode="TEST-USER"]');
      await row.waitFor({ state: 'visible' });
      assert.match((await row.locator('.member-sub').innerText()).replace(/\s+/g, ' '), /Mathematics.*A Long Song Name/);
      const sub = await row.locator('.member-sub').evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight), topClass: el.querySelector('.member-class-text').getBoundingClientRect().top, topMusic: el.querySelector('.member-spotify-text').getBoundingClientRect().top }));
      assert.ok(sub.height <= sub.lineHeight + 1, 'class and music share one line'); assert.ok(Math.abs(sub.topClass - sub.topMusic) < 2);
      await row.click(); await page.waitForSelector('.user-profile-popover.is-open');
      assert.equal(await page.locator('#user-profile-card .spotify-track-name').innerText(), 'A Long Song Name');
      assert.equal(await page.locator('#user-profile-card .spotify-track-artist').innerText(), 'Test Artist');
      assert.equal(await page.locator('#user-profile-card .spotify-album-art').count(), 1);
      const dir = path.resolve(__dirname, '../../spotify-checks'); fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `spotify-${desktop ? 'desktop' : 'web'}.png`) });
      if (desktop) {
        await page.locator('#user-profile-card .spotify-play').click();
        assert.deepEqual(await page.evaluate(() => __spotifyOpened), ['1234567890abcdefghijkl']);
        await page.evaluate(() => { ChatApp.closeUserProfile(true); document.querySelector('#btn-side-settings').click(); });
        await page.click('#settings-tab-account'); await page.click('#settings-spotify-disconnect');
        await page.waitForFunction(() => !ChatApp.getUserSpotifyTrack(ChatApp.currentUser));
        assert.equal(await page.locator('#settings-spotify-connect').isVisible(), true);
      } else assert.equal(await page.locator('#user-profile-card .spotify-play').getAttribute('href'), 'https://open.spotify.com/track/1234567890abcdefghijkl');
      assert.deepEqual(errors, []);
      console.log(`${desktop ? 'Desktop' : 'Web'} Spotify: account controls, public profile, song action, one-line class/music passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
