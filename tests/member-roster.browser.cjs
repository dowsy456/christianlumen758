/* Regressions run only against the in-memory database, never production. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const mock = require('./firebase-mock.js');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(mock);
    await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'null' }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.click('#btn-go-login');
    await page.fill('#login-code', 'TEST-USER');
    await page.click('#btn-login');
    await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER');
    await page.evaluate(async () => {
      const db = window.__testDatabase;
      await db.ref('rooms/other').set({ name: 'Other room', createdBy: 'TEST-USER' });
      for (const [code, record] of [['ALICE', { username: 'Alice' }], ['REAL-USER', { username: 'User' }], ['AUTHOR', { username: 'CalendarAuthor' }], ['MALFORMED', { calendarReminders: { note: true } }]]) {
        await db.ref(`users/${code}`).set(record);
      }
      for (const code of ['TEST-USER', 'ALICE', 'REAL-USER', 'ORPHAN', 'MALFORMED']) {
        await db.ref(`memberships/${code}`).set({ test: true, other: true });
      }
      await db.ref('memberships/NOT-JOINED/test').set(false);
      await db.ref('rooms/test/online/ORPHAN').set({ username: 'FormerAccount', typing: true });
      await db.ref('rooms/test/online/PRESENCE-ONLY').set({ username: 'Nobody' });
      await db.ref('rooms/test/online/not-a-presence').set(true);
      await db.ref('calls/test/members/NO-ACCOUNT').set({ connected: true, username: 'Missing', joinedAt: Date.now() });
      await ChatApp.openRoom('test', { quiet: true });
    });
    const roster = () => page.locator('#online-list .member-row').evaluateAll(rows => rows.map(row => row.dataset.usercode).sort());
    await page.waitForFunction(() => ChatApp.liveUserCache.get('ALICE')?.username === 'Alice' && ChatApp.liveUserCache.has('ORPHAN'));
    assert.deepEqual(await roster(), ['ALICE', 'REAL-USER', 'TEST-USER'], 'membership and presence records require an actual account');

    const row = page.locator('#online-list .member-row[data-usercode="ALICE"]');
    let menuOpens = 0;
    await page.exposeFunction('__countMemberMenu', () => { menuOpens++; });
    await page.evaluate(() => {
      const original = ChatApp.openAvatarContextMenuFor;
      ChatApp.openAvatarContextMenuFor = (...args) => { window.__countMemberMenu(); return original(...args); };
    });
    for (const target of [row.locator('.member-name'), row.locator('.online-ava-img'), row]) {
      await target.click({ button: 'right', position: target === row ? { x: 220, y: 20 } : undefined });
      await page.waitForFunction(() => ChatApp.msgMenuCtx?.menu === 'avatar' && ChatApp.msgMenuCtx?.userCode === 'ALICE' && !ChatApp.msgMenuEl.hidden);
      assert.equal(await page.evaluate(() => ChatApp.msgMenuCtx.username), 'Alice');
      await page.evaluate(() => ChatApp.closeMsgMenu(true));
    }
    assert.equal(menuOpens, 3, 'name, avatar, and empty row area each open the existing menu exactly once');

    // Calendar author cache hydration must never add a nonmember to a room.
    await page.waitForFunction(() => ChatApp.calendarState?.ready);
    await page.evaluate(async () => {
      const author = { code: 'AUTHOR', username: 'CalendarAuthor' };
      const authorKey = await ChatApp.sha256Hex(author.username.toLowerCase());
      await ChatApp.db.ref(`usernames/${authorKey}`).set({ code: author.code });
      const date = ChatApp.calendarState.today;
      await ChatApp.db.ref(`calendar/years/${ChatApp.calendarState.year}/${date}/author-note`).set({ text: 'Author outside this room', authorUsername: author.username, createdAt: Date.now(), updatedAt: Date.now() });
      ChatApp.showCalendarDay(date);
    });
    await page.locator('.calendar-author-button:not(:disabled)').waitFor();
    for (const roomId of ['other', 'test', 'other', 'test']) {
      await page.evaluate(roomId => ChatApp.openRoom(roomId, { quiet: true }), roomId);
      await page.waitForFunction(() => document.querySelectorAll('#online-list .member-row').length === 3);
      assert.deepEqual(await roster(), ['ALICE', 'REAL-USER', 'TEST-USER'], `Calendar navigation and ${roomId} room transitions do not create extra people`);
    }

    // A room subscription may already have queued a callback when Calendar detaches it.
    await page.evaluate(() => {
      const staleMembers = ChatApp.roomMembersCb;
      ChatApp.showCalendarPage();
      staleMembers({ exists: () => true, val: () => ({ AUTHOR: { test: true } }) });
      if (ChatApp.roomMembersCache.size !== 0) throw new Error('Detached room callback repopulated the members cache');
    });
    await page.evaluate(() => ChatApp.openRoom('test', { quiet: true }));
    await page.waitForFunction(() => document.querySelectorAll('#online-list .member-row').length === 3);

    await page.evaluate(() => ChatApp.db.ref('users/ALICE').remove());
    await row.waitFor({ state: 'detached' });
    assert.deepEqual(await roster(), ['REAL-USER', 'TEST-USER'], 'a deleted member disappears even while the membership remains');
    await page.evaluate(() => ChatApp.db.ref('users/ALICE').set({ username: 'AliceRestored' }));
    await row.waitFor();
    assert.equal(await row.locator('.member-name').textContent(), 'AliceRestored');

    // A resolved Calendar author from an earlier render cannot resurrect a deleted account.
    await page.evaluate(() => ChatApp.showCalendarDay(ChatApp.calendarState.today));
    await page.locator('.calendar-author-button:not(:disabled)').waitFor();
    await page.evaluate(async () => { await ChatApp.db.ref('users/AUTHOR').remove(); ChatApp.renderCalendar(); });
    await page.waitForFunction(() => ChatApp.liveUserCache.get('AUTHOR') === null);
    await page.evaluate(() => ChatApp.renderCalendar());
    assert.equal(await page.locator('.calendar-author-button').isDisabled(), true);
    assert.equal(await page.evaluate(() => ChatApp.liveUserCache.get('AUTHOR')), null);

    // Firebase val() returns an array for dense numeric room keys. An offline
    // member has no room/call presence to compensate for skipping that map.
    await page.evaluate(async () => {
      const db = window.__testDatabase;
      await db.ref('rooms/1').set({ name: 'Numbered room', createdBy: 'TEST-USER' });
      await db.ref('memberships/TEST-USER/1').set({ joinedAt: Date.now() });
      for (const [code, username] of [['WILLIAM', 'William'], ['LEGACY', 'LegacyMember'], ['NOT-JOINED', 'NotJoined']]) {
        await db.ref(`users/${code}`).set({ username });
      }
      await db.ref('memberships/WILLIAM').set([null, { joinedAt: Date.now() }]);
      await db.ref('memberships/LEGACY').set([null, true]);
      await db.ref('memberships/ORPHAN').set([null, true]);
      await db.ref('memberships/MALFORMED').set([null, true]);
      await db.ref('memberships/NOT-JOINED').set([null, false]);
      await ChatApp.openRoom('1', { quiet: true });
    });
    await page.waitForFunction(() => ChatApp.roomMembersCache.has('TEST-USER'));
    assert.equal(await page.evaluate(() => ChatApp.roomMembersCache.has('WILLIAM')), true,
      'offline members of numbered rooms must survive Firebase array serialization');
    await page.waitForFunction(() => ChatApp.liveUserCache.get('WILLIAM')?.username === 'William' && ChatApp.liveUserCache.get('LEGACY')?.username === 'LegacyMember');
    const numericRoster = ['LEGACY', 'TEST-USER', 'WILLIAM'];
    assert.deepEqual(await roster(), numericRoster, 'numeric memberships retain real offline users without restoring phantom members');
    const william = page.locator('#online-list .member-row[data-usercode="WILLIAM"]');
    assert.equal(await william.locator('.member-name').textContent(), 'William');
    assert.equal(await william.locator('.member-status-dot').getAttribute('data-state'), 'offline');
    assert.equal(await page.evaluate(() => ChatApp.onlineLabelEl.textContent), 'Members - 3');
    assert.equal(await page.evaluate(() => ChatApp.onlinePresenceCache.has('WILLIAM') || ChatApp.roomCallMembersCache.has('WILLIAM') || ChatApp.appPresenceCache.has('WILLIAM')), false,
      'the offline fixture must not rely on presence to appear');

    // Joining/leaving a named room changes Firebase's map representation only.
    for (const memberships of [{ 1: { joinedAt: 123 }, general: true }, [null, { joinedAt: 123 }]]) {
      await page.evaluate(value => ChatApp.db.ref('memberships/WILLIAM').set(value), memberships);
      assert.deepEqual(await roster(), numericRoster, 'array/object transitions retain the same room member');
    }
    // A sparse array hole is not membership; adding the child restores it.
    await page.evaluate(() => ChatApp.db.ref('memberships/WILLIAM').set([null, null, true]));
    await william.waitFor({ state: 'detached' });
    assert.deepEqual(await roster(), ['LEGACY', 'TEST-USER']);
    await page.evaluate(() => ChatApp.db.ref('memberships/WILLIAM').set([null, { joinedAt: 123 }, true]));
    await william.waitFor();
    assert.deepEqual(await roster(), numericRoster);
    await page.evaluate(() => ChatApp.showCalendarPage());
    await page.evaluate(() => ChatApp.openRoom('1', { quiet: true }));
    await william.waitFor();
    assert.deepEqual(await roster(), numericRoster, 'offline members survive Calendar and room navigation');
    assert.deepEqual(errors, []);
    console.log('Offline numeric-room members, member roster, Calendar navigation/deletion, and whole-row context menus: PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
