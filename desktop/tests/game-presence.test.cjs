'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function harness() {
  const writes = [], events = {}, timers = new Map(), refs = new Map(); let initializer;
  let now = 1000000;
  const App = { appPresenceNow: () => now, register(_id, init) { initializer = init; }, getUserHtmlActivity(user) { return user?.htmlActivity?.title ? user.htmlActivity : null; }, getUserActivityItems(user) { return user?.htmlActivity ? [{ kind: 'html', label: user.htmlActivity.title }] : []; }, startAppPresence() {}, stopAppPresence() {}, liveUserCache: new Map(), firebase: { database: { ServerValue: { TIMESTAMP: 'server-time' } } }, renderOnlineIndicator() {}, refreshOpenUserProfileCard() {} };
  const bridge = { enabled: [], setEnabled(value) { this.enabled.push(value); }, getSnapshot: async () => ({ games: [] }), onChange(callback) { this.changed = callback; } };
  App.db = { ref(key) {
    if (!refs.has(key)) refs.set(key, { key, set: async value => { writes.push({ key, value }); }, remove: async () => { writes.push({ key, value: null }); }, onDisconnect: () => ({ remove: async () => {}, cancel: async () => {} }), on(_type, callback) { this.callback = callback; }, off() { this.callback = null; } });
    return refs.get(key);
  } };
  const schedule = (type, fn, delay) => { const id = {}; timers.set(id, {type,fn,delay});return id; };
  class Clock extends Date { static now() { return now; } }
  const context = { ChatApp: App, console, window: { chatDesktopGames: bridge, addEventListener: (name, callback) => { events[name] = callback; } }, setInterval: (fn,delay) => schedule('interval',fn,delay), clearInterval: id => timers.delete(id), setTimeout:(fn,delay)=>schedule('timeout',fn,delay), clearTimeout:id=>timers.delete(id), queueMicrotask, crypto: { randomUUID: () => 'device-session' }, Date:Clock, Map };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../js/chat/game-presence.js'), 'utf8'), context); initializer();
  return { App, now, writes, refs, bridge, timers, events, advance:milliseconds=>{now+=milliseconds;} };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('live multi-device games stack with multiple HTMLs and stale device records disappear', () => {
  const { App, now } = harness();
  const user = { htmlActivity: { title: 'Legacy' }, htmlActivities: { a: { updatedAt: now, items: [{ title: 'First', type: 'hub', hubId: 'a' }] }, b: { updatedAt: now, items: [{ title: 'Second', type: 'hub', hubId: 'b' }] }, stale: { updatedAt: now - 100000, items: [{ title: 'Stale' }] } }, gameActivitySessions: { desktop: { updatedAt: now, games: [{ id: 'one', title: 'Roblox' }, { id: 'two', title: 'Minecraft' }] }, duplicate: { updatedAt: now, games: [{ id: 'one', title: 'Roblox' }] }, old: { updatedAt: now - 100000, games: [{ title: 'Expired' }] } } };
  assert.deepEqual(Array.from(App.getUserActivityItems(user), item => item.label), ['Playing First', 'Playing Second', 'Playing Minecraft', 'Playing Roblox']);
  user.htmlActivities = null; assert.equal(App.getUserHtmlActivities(user)[0].title, 'Legacy');
  user.htmlActivitiesVersion = 1; assert.equal(App.getUserHtmlActivities(user).length, 0, 'closed migrated HTML sessions cannot revive legacy global presence');
});

test('unchanged game scans and lease heartbeats cause no repeated profile repaint or redundant scan writes', async () => {
  const h=harness();let renders=0;
  h.App.renderOnlineIndicator=()=>{renders++;};
  h.App.currentUser={code:'alice'};h.App.startGamePresence();await flush();
  h.refs.get('.info/connected').callback({val:()=>true});await flush();
  h.bridge.changed({games:[{id:'one',title:'Roblox'}]});await flush();
  const firstWrites=h.writes.length, firstRenders=renders;
  for(let i=0;i<60;i++){
    h.advance(1000);h.bridge.changed({games:[{id:'one',title:'Roblox'}]});
    await h.App.writeGamePresence();await flush();
  }
  assert.equal(h.writes.length-firstWrites,2,'only two 25-second lease renewals, not 60 scan writes');
  assert.equal(renders,firstRenders,'timestamps do not repaint the profile/roster');
  h.bridge.changed({games:[]});await flush();
  const stopped=h.writes.length;
  h.advance(100000);await h.App.writeGamePresence();await flush();
  assert.equal(h.writes.length,stopped,'an idle account does not repeatedly write null');
  h.App.stopGamePresence();
});

test('remote activity expiration uses one deadline and does not poll/repaint an idle profile', async()=>{
  const h=harness();let renders=0;
  h.App.renderOnlineIndicator=()=>renders++;
  assert.equal(h.timers.size,0,'feature initialization starts no timer');
  const user={code:'bob',gameActivitySessions:{device:{updatedAt:h.now,games:[{id:'one',title:'Game'}]}}};
  h.App.liveUserCache.set('bob',user);h.App.observeActivityPresenceUser(user);await flush();
  assert.equal(renders,0);assert.equal(h.timers.size,1);
  const [id,expiry]=[...h.timers][0];assert.equal(expiry.type,'timeout');
  h.advance(90001);h.timers.delete(id);expiry.fn();await flush();
  assert.equal(renders,1);assert.equal(h.timers.size,0,'expired user leaves no polling timer');
  assert.equal(h.App.getUserGameActivities(user).length,0);
});
test('game presence waits for connection cleanup, heartbeats only this device, and logout stops detection', async () => {
  const h = harness(); h.App.startGamePresence(); assert.equal(h.App.gamePresenceSession, undefined);
  h.App.currentUser = { code: 'alice', gameActivitySessions: { otherPC: { updatedAt: h.now, games: [{ title: 'Other Game' }] } } };
  h.App.startGamePresence(); await flush(); assert.equal(h.bridge.enabled.at(-1), true); assert.equal(h.writes.length, 0);
  h.refs.get('.info/connected').callback({ val: () => true }); await flush();
  h.bridge.changed({ games: [{ id: 'roblox', title: 'Roblox', path: 'private' }] }); await flush();
  const write = h.writes.at(-1); assert.equal(write.key, 'users/alice/gameActivitySessions/device-session'); assert.deepEqual(JSON.parse(JSON.stringify(write.value)), { games: [{ id: 'roblox', title: 'Roblox' }], updatedAt: 'server-time' });
  assert.ok(h.App.currentUser.gameActivitySessions.otherPC); assert.doesNotMatch(JSON.stringify(write), /private/);
  h.App.stopAppPresence(); await flush(); assert.equal(h.bridge.enabled.at(-1), false); assert.equal(h.App.gamePresenceSession, null); assert.equal(h.refs.get('.info/connected').callback, null); assert.ok(h.writes.every(write => write.key.endsWith('/device-session')));
  const count = h.writes.length; h.bridge.changed({ games: [{ title: 'After Logout' }] }); await flush(); assert.equal(h.writes.length, count);
});
