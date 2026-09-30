/* Uses the in-memory fixture; run: node tests/people-settings.browser.cjs */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const installFirebaseMock = require('./firebase-mock.js');

(async () => {
  const browser = await chromium.launch({channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true});
  try {
    for (const device of [
      {name: 'desktop', viewport: {width: 1440, height: 900}},
      {name: 'ios', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'},
      {name: 'android', viewport: {width: 412, height: 915}, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'}
    ]) {
      const {name, ...options} = device;
      const context = await browser.newContext(options);
      await context.addInitScript(installFirebaseMock);
      await context.route(/^https?:\/\//, route => route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: 'null'}));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await page.click('#btn-go-login');
      await page.fill('#login-code', 'TEST-USER');
      await page.click('#btn-login');
      await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER');
      await page.evaluate(() => ChatApp.openRoom('test', {quiet: true}));
      await page.waitForFunction(() => ChatApp.currentRoomId === 'test' && !ChatApp.bulkLoading);
      await page.evaluate(() => document.querySelector('#btn-side-settings').click());
      await page.waitForSelector('.settings-tabs');
      assert.equal(await page.locator('.settings-pane:visible').count(), 1);
      assert.equal(await page.getAttribute('#settings-tab-profile', 'aria-selected'), 'true');
      await page.fill('#settings-bio', 'A compact profile with a saved draft.');
      await page.click('#settings-tab-account');
      assert.equal(await page.locator('#settings-code-display:visible').count(), 1);
      assert.equal(await page.locator('#btn-settings-copy:visible').count(), 1);
      assert.equal(await page.locator('#btn-logout:visible').count(), 1);
      await page.fill('#settings-search-input', 'Sound Effects');
      assert.equal(await page.locator('#settings-sound-effects').count(), 1);
      assert.equal(await page.locator('.settings-search-empty:visible').count(), 0);
      await page.fill('#settings-search-input', 'Auto Scroll');
      assert.equal(await page.locator('.settings-toggle-card:has(#settings-autoscroll):visible').count(), 1);
      assert.equal(await page.locator('#settings-pane-preferences:visible').count(), 1);
      await page.fill('#settings-search-input', 'zzzz-no-setting');
      assert.equal(await page.locator('.settings-search-empty:visible').count(), 1);
      await page.fill('#settings-search-input', '');
      assert.equal(await page.getAttribute('#settings-tab-account', 'aria-selected'), 'true');
      await page.click('#settings-tab-profile');
      assert.equal(await page.inputValue('#settings-bio'), 'A compact profile with a saved draft.');
      await page.waitForFunction(() => __testDatabase.get('users/TEST-USER/bio') === 'A compact profile with a saved draft.');
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.settings-refresh input:not([type="checkbox"]), .settings-refresh textarea, .settings-refresh .settings-panel')].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || el.getBoundingClientRect().left < -1)).map(el => el.id || el.className));
      assert.deepEqual(overflow, [], `${name}: settings controls must fit the viewport`);
      for (const tab of ['appearance', 'preferences', 'account']) {
        await page.click(`#settings-tab-${tab}`);
        assert.equal(await page.locator('.settings-pane:visible').count(), 1);
      }
      await page.keyboard.press('Home');
      assert.equal(await page.getAttribute('#settings-tab-profile', 'aria-selected'), 'true');
      if (process.env.QA_SCREENSHOTS) {
        await page.waitForTimeout(350);
        await page.screenshot({path: path.join(process.env.QA_SCREENSHOTS, `settings-${name}.png`)});
      }
      await page.evaluate(() => ChatApp.closeModal());
      await page.evaluate(() => {
        ChatApp.setMembersListVisible?.(true);
        if (document.body.dataset.membersSidebar !== '1') ChatApp.toggleMembersListVisibility();
      });
      await page.waitForSelector('.members-sidebar .member-row');
      await page.click('.members-sidebar .member-row');
      await page.waitForSelector('.user-profile-popover.is-open');
      assert.equal(await page.locator('#user-profile-card .user-profile-presence').textContent(), 'Online');
      const bounds = await page.locator('#user-profile-popover').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= options.viewport.width + 1, `${name}: profile must fit viewport`);
      if (name !== 'desktop') assert(await page.evaluate(() => +getComputedStyle(document.querySelector('#user-profile-popover')).zIndex > +getComputedStyle(document.querySelector('#members-sidebar')).zIndex));
      await page.evaluate(() => ChatApp.refreshOpenUserProfileCard());
      await page.click('#user-profile-card .user-profile-more');
      await page.waitForFunction(() => ChatApp.msgMenuEl && !ChatApp.msgMenuEl.hidden);
      await page.evaluate(() => ChatApp.closeMsgMenu(true));
      if (process.env.QA_SCREENSHOTS) await page.screenshot({path: path.join(process.env.QA_SCREENSHOTS, `profile-${name}.png`)});
      await page.click('#user-profile-card .user-profile-close');
      await page.waitForFunction(() => document.querySelector('#user-profile-popover').hidden);
      assert.deepEqual(errors, [], `${name}: no runtime errors`);
      console.log(`${name}: settings tabs/search/drafts/account actions/layout; member profiles/actions/close passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
