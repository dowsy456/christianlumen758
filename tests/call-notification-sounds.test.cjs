'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const member = (code, extra = {}) => ({ code, sessionId:`session-${code}`, connected:true, ...extra });
function setup() {
  const sounds = [];
  const App = { register() {}, currentUser:{ code:'self' }, currentCallRoomId:'one', callSessionId:'self-session', playNotificationSound: name => sounds.push(name) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../js/calling/notification-sounds.js'),'utf8'), { ChatApp:App });
  return { App, sounds };
}
test('successful self join sounds once with quiet existing roster; failed or cancelled joins never activate sounds', () => {
  const { App, sounds } = setup();
  App.callObserveNotificationMembers('one', [member('existing')]);
  App.callStartNotificationSession('wrong', 'self-session', []);
  App.callStartNotificationSession('one', 'cancelled-session', []);
  App.callStopNotificationSession('one', 'self-session');
  assert.deepEqual(sounds, []);
  App.callStartNotificationSession('one', 'self-session', [member('self'),member('existing')]);
  App.callStartNotificationSession('one', 'self-session', [member('self'),member('existing')]);
  App.callObserveNotificationMembers('one', [member('self'),member('existing')]);
  assert.deepEqual(sounds, ['JoinCall']);
  App.callStopNotificationSession('one', 'self-session');
  App.callStopNotificationSession('one', 'self-session');
  App.callObserveNotificationMembers('one', []);
  assert.deepEqual(sounds, ['JoinCall','LeaveCall']);
});
test('only actual participant additions/removals sound; metadata, reconnect grace and ringing ghosts are silent', () => {
  const { App, sounds } = setup();
  App.callStartNotificationSession('one','self-session',[member('peer')]);
  App.callObserveNotificationMembers('one',[member('peer',{muted:true,speaking:true,updatedAt:1000})]);
  App.callObserveNotificationMembers('one',[member('peer',{connected:false,disconnectedAt:1001})]);
  App.callObserveNotificationMembers('one',[member('peer',{connected:true,sessionId:'replacement-peer'})]);
  App.callObserveNotificationMembers('one',[member('peer'),{code:'ring-target'},member('ring-card',{ringing:true}),member('pending',{joinConfirmed:false})]);
  assert.deepEqual(sounds,['JoinCall']);
  App.callObserveNotificationMembers('one',[member('peer'),member('pending',{joinConfirmed:true})]);
  App.callObserveNotificationMembers('one',[member('pending')]);
  assert.deepEqual(sounds,['JoinCall','JoinCall','LeaveCall']);
});
test('local disconnect freezes sounds and reconnect silently rebases before tracking later changes', () => {
  const { App, sounds } = setup();
  App.callStartNotificationSession('one','self-session',[member('old')]);
  App.callSetNotificationConnectionState('one','self-session',false);
  App.callObserveNotificationMembers('one',[],{expiry:true});
  App.callObserveNotificationMembers('one',[member('during-outage')]);
  App.callSetNotificationConnectionState('one','self-session',true);
  App.callObserveNotificationMembers('one',[],{expiry:true});
  App.callObserveNotificationMembers('one',[member('during-outage')]);
  assert.deepEqual(sounds,['JoinCall']);
  App.callObserveNotificationMembers('one',[member('during-outage'),member('new')]);
  App.callObserveNotificationMembers('one',[member('new')]);
  assert.deepEqual(sounds,['JoinCall','JoinCall','LeaveCall']);
});
test('viewing another room keeps current call sounds; switching calls resets baseline and ignores stale callbacks', () => {
  const { App, sounds } = setup();
  App.callStartNotificationSession('one','self-session',[member('peer')]);
  App.currentRoomId = 'two';
  App.callObserveNotificationMembers('two',[member('unrelated')]);
  App.callObserveNotificationMembers('one',[member('peer'),member('friend')]);
  App.callStopNotificationSession('one','self-session');
  App.currentCallRoomId = 'two'; App.callSessionId = 'new-self-session';
  App.callStartNotificationSession('two','new-self-session',[member('unrelated')]);
  App.callSetNotificationConnectionState('one','self-session',false);
  App.callStopNotificationSession('one','self-session');
  App.callObserveNotificationMembers('one',[]);
  App.callObserveNotificationMembers('two',[member('unrelated')]);
  assert.deepEqual(sounds,['JoinCall','JoinCall','LeaveCall','JoinCall']);
  App.callObserveNotificationMembers('two',[]);
  assert.deepEqual(sounds,['JoinCall','JoinCall','LeaveCall','JoinCall','LeaveCall']);
});

test('screen effects reach the call; watching effects reach the sharer and other current watchers only', () => {
  const codes = ['owner', 'alice', 'bob', 'outside'];
  const clients = codes.map(code => {
    const client = setup();
    client.App.currentUser.code = code;
    client.App.callSessionId = `session-${code}`;
    return client;
  });
  let roster = codes.map(code => member(code));
  for (const { App, sounds } of clients) {
    App.callStartNotificationSession('one', App.callSessionId, roster);
    sounds.length = 0;
  }
  const publish = () => clients.forEach(({ App }) => App.callObserveNotificationMembers('one', roster));
  const effect = expected => {
    clients.forEach(({ sounds }, index) => { assert.deepEqual(sounds, expected[index], codes[index]); sounds.length = 0; });
  };
  roster = roster.map(item => item.code === 'owner' ? { ...item, sharing: true, shareId: 'screen-one' } : item);
  publish(); publish();
  effect(codes.map(() => ['StartScreen']));
  const watch = (code, enabled) => {
    roster = roster.map(item => item.code === code ? { ...item, viewingSharesSessionId: item.sessionId, viewingShares: enabled ? { owner: 'screen-one' } : {} } : item);
    publish(); publish();
  };
  watch('alice', true);
  effect([['StartWatching'], [], [], []]);
  watch('bob', true);
  effect([['StartWatching'], ['StartWatching'], [], []]);
  watch('alice', false);
  effect([['StopWatching'], [], ['StopWatching'], []]);
  roster = roster.map(item => item.code === 'owner' ? { ...item, sharing: false, shareId: '' } : item);
  publish();
  effect(codes.map(() => ['EndScreen']));
});

test('pre-existing screens and reconnect snapshots are silent; replacing a share ends its old generation', () => {
  const { App, sounds } = setup();
  const old = member('owner', { sharing: true, shareId: 'old' });
  App.callStartNotificationSession('one', 'self-session', [member('self'), old]);
  sounds.length = 0;
  App.callObserveNotificationMembers('one', [member('self'), old]);
  assert.deepEqual(sounds, []);
  App.callObserveNotificationMembers('one', [member('self'), { ...old, shareId: 'new' }]);
  assert.deepEqual(sounds, ['EndScreen', 'StartScreen']);
  sounds.length = 0;
  App.callSetNotificationConnectionState('one', 'self-session', false);
  App.callObserveNotificationMembers('one', []);
  App.callSetNotificationConnectionState('one', 'self-session', true);
  App.callObserveNotificationMembers('one', [member('self'), old]);
  assert.deepEqual(sounds, []);
});

test('local capture effects deduplicate realtime echoes and screen stop remains audible during leave', () => {
  const { App, sounds } = setup();
  const self = member('self', { sessionId: 'self-session' });
  App.callStartNotificationSession('one', 'self-session', [self]);
  sounds.length = 0;
  App.callNotifyLocalScreenState('one', 'self-session', 'local-screen');
  App.callObserveNotificationMembers('one', [{ ...self, sharing: true, shareId: 'local-screen' }]);
  assert.deepEqual(sounds, ['StartScreen']);
  App.callLeavePending = true;
  App.callNotifyLocalScreenState('one', 'self-session', '');
  App.callStopNotificationSession('one', 'self-session');
  assert.deepEqual(sounds, ['StartScreen', 'EndScreen', 'LeaveCall']);
  App.callNotifyLocalScreenState('one', 'self-session', 'stale-screen');
  assert.equal(sounds.length, 3);
});
