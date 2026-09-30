'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
const track = { id: '1234567890abcdefghijkl', title: 'Song', artist: 'Artist', album: 'Album', image: 'https://i.scdn.co/image/cover' };
function harness({ desktop = true } = {}) {
  const initializers = [], timers = new Map(), refs = new Map(), writes = [], events = {};
  let now = 1000000, sessionId = 0, renders = 0, profiles = 0;
  const App = { register: (_id, init) => initializers.push(init), appPresenceNow: () => now, getUserHtmlActivity: () => null, getUserActivityItems: () => [], startAppPresence() {}, stopAppPresence() {}, renderOnlineIndicator: () => ++renders, refreshOpenUserProfileCard: () => ++profiles, liveUserCache: new Map(), $: () => null, escapeHtml: text => String(text).replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`), escapeAttr: text => String(text).replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`), firebase: { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } } };
  const bridge = { setUser: async accountCode => ({ accountCode, configured: true, connected: false }), onChange(callback) { this.change = callback; } };
  App.db = { ref(key) {
    if (!refs.has(key)) refs.set(key, { key, set: async value => writes.push({ key, value }), remove: async () => writes.push({ key, value: null }), onDisconnect: () => ({ remove: async () => {}, cancel: async () => {} }), on(_event, callback) { this.callback = callback; }, off() { this.callback = null; } });
    return refs.get(key);
  } };
  class Clock extends Date { static now() { return now; } }
  const context = { ChatApp: App, console, URL, document: { addEventListener() {} }, window: { chatDesktopSpotify: desktop ? bridge : undefined, addEventListener: (name, callback) => { events[name] = callback; } }, Date: Clock, crypto: { randomUUID: () => `spotify-${++sessionId}` }, queueMicrotask, setInterval: (fn, delay) => { const id = {}; timers.set(id, { fn, delay, type: 'interval' }); return id; }, clearInterval: id => timers.delete(id), setTimeout: (fn, delay) => { const id = {}; timers.set(id, { fn, delay, type: 'timeout' }); return id; }, clearTimeout: id => timers.delete(id) };
  for (const file of ['game-presence.js', 'spotify-presence.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/chat', file), 'utf8'), context);
  initializers.forEach(init => init());
  return { App, bridge, refs, writes, events, timers, advance: ms => { now += ms; }, get now() { return now; }, get renders() { return renders; }, get profiles() { return profiles; } };
}
test('web sees public listening metadata without native account controls or publishing', () => {
  const f = harness({ desktop: false });
  const user = { code: 'alice', spotifySessions: { desktop: { track, updatedAt: f.now } } };
  assert.equal(f.App.getUserSpotifyTrack(user).title, 'Song');
  assert.equal(f.App.getUserActivityItems(user)[0].kind, 'spotify');
  assert.equal(f.App.spotifyAccountSettingsHTML(), '');
  f.App.currentUser = user; f.App.startSpotifyPresence(); assert.equal(f.writes.length, 0);
});
test('desktop publishes only normalized track fields and removes its own session on disconnect/logout', async () => {
  const f = harness(); f.App.currentUser = { code: 'alice', spotifySessions: { other: { track, updatedAt: f.now } } }; f.App.startSpotifyPresence(); await flush();
  f.refs.get('.info/connected').callback({ val: () => true }); await flush();
  f.bridge.change({ accountCode: 'alice', connected: true, configured: true, track: { ...track, refreshToken: 'SECRET', accessToken: 'SECRET' } }); await flush();
  const live = f.writes.at(-1); assert.equal(live.key, 'users/alice/spotifySessions/spotify-1'); assert.equal(live.value.track.title, 'Song'); assert.doesNotMatch(JSON.stringify(f.writes), /SECRET|refreshToken|accessToken/);
  assert.equal(f.App.currentUser.spotifySessions.other.track.title, 'Song');
  const count = f.writes.length; await f.App.writeSpotifyPresence(); assert.equal(f.writes.length, count, 'same track is not rewritten on each native poll');
  f.bridge.change({ accountCode: 'alice', connected: false }); await flush(); assert.equal(f.writes.at(-1).value, null);
  f.App.stopSpotifyPresence(); await flush(); assert.equal(f.App.spotifyPresenceSession, null); assert.equal(f.writes.at(-1).key, live.key);
  const stopped = f.writes.length; f.bridge.change({ accountCode: 'alice', connected: true, track }); await flush(); assert.equal(f.writes.length, stopped);
});
test('remote music expires and repaints an open profile without another database event', async () => {
  const f = harness({ desktop: false }), user = { code: 'alice', spotifySessions: { desktop: { track, updatedAt: f.now } } };
  f.App.liveUserCache.set('alice', user); f.App.userProfileOpen = true; f.App.userProfilePinnedCode = 'alice';
  f.App.observeActivityPresenceUser(user); await flush();
  const timer = [...f.timers.values()].find(timer => timer.type === 'timeout'); assert.equal(timer.delay, 90001);
  f.advance(90001); timer.fn(); await flush();
  assert.equal(f.App.getUserSpotifyTrack(user), null); assert.equal(f.renders, 1); assert.equal(f.profiles, 1);
});
test('unsafe track links/images are rejected and rendered track text is escaped', () => {
  const f = harness();
  assert.equal(f.App.normalizeSpotifyTrack({ ...track, id: 'javascript:bad' }), null);
  const safe = f.App.normalizeSpotifyTrack({ ...track, title: '<img onerror="bad">', image: 'https://evil.invalid/x', url: 'javascript:alert(1)' });
  assert.equal(safe.image, ''); assert.match(safe.url, /^https:\/\/open.spotify.com\/track\//);
  const html = f.App.spotifyProfileMarkup(safe); assert.doesNotMatch(html, /<img onerror|javascript:|evil\.invalid/); assert.match(html, /&#60;img/);
});
