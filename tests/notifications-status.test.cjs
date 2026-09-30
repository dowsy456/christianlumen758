'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const installFirebaseMock = require('./firebase-mock.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ desktop = true, audioState = 'running' } = {}) {
  const sounds = [], notifications = [], sources = [], gains = [], compressors = [];
  const initializers = [];
  const audioContexts = [];
  class AudioContext {
    constructor() { this.state = audioState; this.currentTime = 1; this.destination = {}; this.events = {}; audioContexts.push(this); }
    addEventListener(event, callback) { this.events[event] = callback; }
    createGain() { const node = { gain: { value: 1, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} }, connect() { return this; }, disconnect() {} }; gains.push(node); return node; }
    createDynamicsCompressor() { const node = { connect() { return this; } }; for (const key of ['threshold','knee','ratio','attack','release']) node[key] = { value: 0 }; compressors.push(node); return node; }
    createBufferSource() { const node = { connect() { return this; }, disconnect() {}, start() { this.started = true; }, stop(when) { this.stoppedAt = when; } }; sources.push(node); return node; }
    decodeAudioData() { return Promise.resolve({}); }
    resume() { return Promise.resolve(); }
  }
  class Notification {
    static permission = 'granted';
    constructor(title, options) { notifications.push({ title, ...options }); }
  }
  const App = {
    register(id, initialize) { initializers.push({ id, initialize }); },
    currentUser: { code: 'TEST-USER', username: 'Tester' },
    membershipMap: new Map([['test', true], ['other', true]]),
    liveUserCache: new Map(), appPresenceCache: new Map([['TEST-USER','idle']]),
    playNotificationSound: sound => sounds.push(sound), pushNotifsEnabled: true,
    roomsMetaCache: new Map(), roomDisplayName: id => `Room ${id}`,
    renderOnlineIndicator() {}, refreshOpenUserProfilePresence() {},
    writeCurrentUserBootstrapCache() {}, seenPingKeys: new Set(),
    getStoredPlace: () => 'home', views: { chat: { dataset: { active: 'true' } } },
    showToast() {}, showPingSummaryToast() {}, escapeHtml: String
  };
  const document = { baseURI: 'https://local.invalid/', hidden: false, addEventListener() {}, getElementById() { return null; } };
  const context = vm.createContext({ ChatApp: App, document, Notification, AudioContext, URL, console, Date, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, CustomEvent: class { constructor(name, options) { this.type=name; this.detail=options.detail; } }, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }) });
  context.window = context;
  context.addEventListener = () => {};
  context.dispatchEvent = () => {};
  if (desktop) context.chatDesktopOverlay = { version: 1 };
  vm.runInContext(`(${installFirebaseMock.toString()})()`, context);
  App.db = context.firebase.database();
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  load('js/profiles/status.js'); load('js/chat/notifications.js');
  return { App, context, document, sounds, sources, gains, compressors, notifications, audioContexts, load };
}
test('all joined rooms notify once for new messages, initial history and room navigation do not replay', async () => {
  const { App, sounds } = setup();
  await App.db.ref('messages/test/old').set({ userCode: 'peer', text: 'history', createdAt: 1 });
  App.syncRoomMessageNotifications(); await flush();
  assert.deepEqual(sounds, []);
  await App.db.ref('messages/test/one').set({ userCode: 'peer', text: 'hello', createdAt: Date.now() });
  await App.db.ref('messages/other/two').set({ userCode: 'peer', text: '@Tester hi', createdAt: Date.now() });
  await flush();
  assert.deepEqual(sounds, ['Message', 'Ping']);
  App.currentRoomId = 'other'; App.syncRoomMessageNotifications(); await flush();
  await App.db.ref('messages/other/two/text').set('@Tester edited'); await flush();
  assert.deepEqual(sounds, ['Message', 'Ping']);
  await App.db.ref('messages/test/self').set({ userCode: 'TEST-USER', text: 'my message' }); await flush();
  assert.deepEqual(sounds, ['Message', 'Ping'], 'own messages are silent');
  App.membershipMap.delete('other'); App.syncRoomMessageNotifications();
  await App.db.ref('messages/other/left').set({ userCode: 'peer', text: 'left' }); await flush();
  assert.equal(sounds.length, 2);
  App.detachRoomMessageNotifications();
  await App.db.ref('messages/test/logout').set({ userCode: 'peer', text: 'logout' }); await flush();
  assert.equal(sounds.length, 2);
});
test('pings produce one silent desktop notification per message; DND never blocks desktop notifications', () => {
  const { App, notifications } = setup();
  App.currentUser.notificationStatus = 'dnd';
  App.handleRoomNotificationMessage('test', 'one', { userCode:'peer', username:'Friend', text:'@Tester hi' });
  App.showDesktopPingNotification({ roomId:'test', fromUsername:'Friend', messageKey:'one' });
  App.handleRoomNotificationMessage('test', 'two', { userCode:'peer', username:'Friend', text:'@everyone again' });
  assert.equal(notifications.length, 2);
  assert.ok(notifications.every(notification => notification.silent));
  assert.notEqual(notifications[0].tag, notifications[1].tag);
  App.handleRoomNotificationMessage('test', 'three', { userCode:'peer', text:'regular' });
  assert.equal(notifications.length, 2);
  App.pushNotifsEnabled = false;
  App.handleRoomNotificationMessage('test', 'four', { userCode:'peer', text:'@Tester hi' });
  assert.equal(notifications.length, 2);
});
test('mention detection respects token boundaries, case and roomwide aliases', () => {
  const { App } = setup();
  for (const text of ['@tester hi','Hi @Tester ','@ALL hi','@a hi','@everyone hi']) assert.equal(App.messagePingsCurrentUser({ text }), true, text);
  for (const text of ['test@Tester.com','@TesterExtra hello','hi tester','@Other hi']) assert.equal(App.messagePingsCurrentUser({ text }), false, text);
});

test('all ten app sound effects default on; per-effect and master preferences gate the shared mixer', async () => {
  const { App, sources, load } = setup();
  load('js/chat/notification-audio.js');
  App.currentSettings = { soundEffectsEnabled: true, soundEffects: App.normalizeSoundEffects({ startwatching:false }) };
  assert.equal(Object.keys(App.soundEffectCatalog).length, 10);
  assert.equal(Object.values(App.normalizeSoundEffects({})).every(Boolean), true);
  App.playNotificationSound('StartWatching');
  await flush();
  assert.equal(sources.length, 0);
  App.playNotificationSound('StartScreen'); App.playNotificationSound('EndScreen'); App.playNotificationSound('StopWatching');
  await flush();
  assert.equal(sources.length, 3, 'enabled screen cues overlap independently');
  App.currentSettings.soundEffectsEnabled = false;
  App.syncSoundEffectPreferences();
  assert.ok(sources.every(source => source.stoppedAt), 'disabling fades active app sound voices');
  App.playNotificationSound('Message'); App.playNotificationSound('JoinCall');
  await flush();
  assert.equal(sources.length, 3, 'master gates messages and call cues alike');
});

test('new screen and watcher sound assets match the existing sound loudness', () => {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/sounds/processing-report.json'), 'utf8'));
  assert.equal(report.sounds.length, 10);
  const levels = report.sounds.map(sound => sound.integratedLUFS);
  assert.ok(Math.max(...levels) - Math.min(...levels) < 0.15, 'all ten cues have matching integrated loudness');
  for (const sound of report.sounds) {
    assert.ok(sound.truePeakDBTP <= report.truePeakCeilingDBTP);
    assert.ok(fs.statSync(path.join(__dirname, '../assets/sounds', sound.file)).size > 1000);
  }
});
test('DND persists while notification-enabled status follows real idle and offline state', async () => {
  const { App, document } = setup();
  assert.equal(await App.setNotificationStatus('dnd'), true);
  assert.equal((await App.db.ref('users/TEST-USER/notificationStatus').once('value')).val(), 'dnd');
  document.hidden = true; App.myRoomIdle = true;
  assert.equal(App.getUserVisiblePresence('TEST-USER'), 'dnd');
  assert.equal(await App.setNotificationStatus('online'), true);
  assert.equal(App.getUserVisiblePresence('TEST-USER'), 'idle');
  App.appPresenceCache.set('TEST-USER', 'offline');
  assert.equal(App.getUserVisiblePresence('TEST-USER'), 'offline');
  App.appPresenceCache.delete('TEST-USER');
  assert.equal(App.getUserVisiblePresence('TEST-USER'), 'offline', 'an absent session never manufactures online presence');
  const web = setup({ desktop:false });
  web.App.currentUser.notificationStatus = 'dnd';
  assert.equal(web.App.isDoNotDisturb(), true);
  assert.equal(await web.App.setNotificationStatus('online'), false);
  assert.equal(web.App.isDoNotDisturb(), true);
});
test('desktop initialization preserves a DND choice saved by another device', async () => {
  const { App } = setup();
  await App.db.ref('users/TEST-USER/notificationStatus').set('dnd');
  App.initializeNotificationStatus(); await flush();
  assert.equal(App.currentUser.notificationStatus, 'dnd');
});
test('account status sync works without any room/profile listener and detaches on logout', async () => {
  const { App } = setup({ desktop:false });
  App.startNotificationStatusSync(); await flush();
  await App.db.ref('users/TEST-USER/notificationStatus').set('dnd'); await flush();
  assert.equal(App.isDoNotDisturb(), true);
  App.stopNotificationStatusSync();
  await App.db.ref('users/TEST-USER/notificationStatus').set('online'); await flush();
  assert.equal(App.isDoNotDisturb(), true, 'detached session cannot modify the signed-out user');
});
test('audio voices overlap with shared compression and independent fading ring loops', async () => {
  const { App, sources, gains, compressors, load } = setup();
  load('js/chat/notification-audio.js');
  App.playNotificationSound('Message'); App.playNotificationSound('Ping'); await flush();
  assert.equal(sources.length, 2);
  assert.ok(sources.every(source => source.started && !source.stoppedAt));
  assert.equal(compressors.length, 1);
  assert.equal(compressors[0].ratio.value, 12);
  assert.ok(gains.slice(1).every(gain => gain.gain.value < 1));
  App.setNotificationLoop('Ringing', true); App.setNotificationLoop('Called', true); await flush();
  assert.equal(sources.filter(source => source.loop).length, 2);
  App.setNotificationLoop('Called', false);
  assert.ok(sources[3].stoppedAt > 1);
  assert.equal(sources[2].stoppedAt, undefined);
  App.currentUser.notificationStatus = 'dnd';
  App.playNotificationSound('Message'); App.playNotificationSound('Ping'); await flush();
  assert.equal(sources.length, 4, 'DND suppresses only message and ping voices');
  App.setNotificationLoop('Called', true); await flush();
  assert.equal(sources.length, 5, 'incoming ringing still blends with outgoing ringing during DND');
  App.stopNotificationAudio();
  assert.ok(sources.every(source => source.stoppedAt));
});
test('blocked loops recover after autoplay unlock and cancelled loops never start later', async () => {
  const { App, audioContexts, sources, load } = setup({ audioState:'suspended' });
  load('js/chat/notification-audio.js');
  App.setNotificationLoop('Ringing', true);
  App.setNotificationLoop('Called', true);
  App.setNotificationLoop('Called', false);
  App.playNotificationSound('Message');
  await flush();
  assert.equal(sources.length, 0);
  audioContexts[0].state = 'running';
  audioContexts[0].events.statechange();
  await flush();
  assert.equal(sources.length, 1, 'only the still-current outgoing loop starts after unlock');
  assert.equal(sources[0].loop, true);
  App.setNotificationLoop('Ringing', true);
  await flush();
  assert.equal(sources.length, 1, 'repeated realtime snapshots do not duplicate a loop');
  App.stopNotificationAudio();
});
test('file previews use media elements without fetch/CORS and bound the combined fallback peak', async () => {
  const { App, context, document, audioContexts, load } = setup();
  document.baseURI = 'file:///C:/chat/index.html';
  const media = [];
  let fetches = 0;
  context.fetch = () => { fetches++; throw new Error('file fetch must not run'); };
  context.Audio = class {
    constructor(src) { this.src = src; this.volume = 1; this.events = {}; media.push(this); }
    addEventListener(name, callback) { this.events[name] = callback; }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  load('js/chat/notification-audio.js');
  App.playNotificationSound('Message'); App.playNotificationSound('Ping');
  App.setNotificationLoop('Called', true); await flush();
  assert.equal(fetches, 0);
  assert.equal(audioContexts.length, 0);
  assert.equal(media.length, 3);
  assert.ok(media.every(audio => audio.src.startsWith('file:///C:/chat/assets/sounds/')));
  assert.ok(media.reduce((sum, audio) => sum + audio.volume, 0) <= 0.700001);
  App.setNotificationLoop('Called', false);
  App.setNotificationLoop('Ringing', true); await flush();
  assert.ok(media.reduce((sum, audio) => sum + audio.volume, 0) <= 0.700001, 'fading and new voices share the same cap');
  App.stopNotificationAudio();
});
test('call joins and leaves remain audible during DND and finish while logout clears other sounds', async () => {
  const { App, sources, load } = setup();
  load('js/chat/notification-audio.js');
  App.currentUser.notificationStatus = 'dnd';
  App.playNotificationSound('JoinCall'); App.playNotificationSound('LeaveCall');
  App.setNotificationLoop('Called', true); await flush();
  assert.equal(sources.length, 3);
  App.stopNotificationAudio({ preserveCallCues:true });
  assert.equal(sources[0].stoppedAt, undefined);
  assert.equal(sources[1].stoppedAt, undefined);
  assert.ok(sources[2].stoppedAt);
  App.stopNotificationAudio();
  assert.ok(sources.every(source => source.stoppedAt));
});
