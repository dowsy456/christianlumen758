'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRingPopups, normalizeRings, ringBounds } = require('../rings.cjs');
const ring = overrides => ({ id: 'r1', roomId: 'room1', roomName: 'Friends', roomIcon: 'data:image/png;base64,AA==', expiresAt: 31000, ...overrides });
test('ring payloads reject expired/malformed records, remote images, duplicates and excessive lifetime', () => {
  const rings = normalizeRings({ rings: [ring(), ring(), ring({ id: 'r2', roomId: 'room2', roomIcon: 'https://tracker.test/image', roomName: 'Other\nRoom' }), ring({ id: 'expired', roomId: 'room3', expiresAt: 500 }), ring({ id: 'forever', roomId: 'room4', expiresAt: 999999 })] }, 1000);
  assert.equal(rings.length, 2); assert.equal(rings[0].roomIcon, 'data:image/png;base64,AA=='); assert.equal(rings[1].roomIcon, ''); assert.equal(rings[1].roomName, 'Other Room');
  assert.deepEqual(normalizeRings(null), []);
});
test('incoming cards stay in top-right work area with a bounded stack', () => {
  const display = { workArea: { x: -1600, y: 100, width: 1600, height: 860 } };
  const bounds = ringBounds(display, 30);
  assert.equal(bounds.x + bounds.width, -12); assert.equal(bounds.y, 112); assert.ok(bounds.height <= 516); assert.ok(bounds.width <= 276);
});
function harness() {
  let time = 1000; const jobs = new Map(), windows = [];
  const timers = { setTimeout(fn, delay) { const id = {}; jobs.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { jobs.delete(id); } };
  class Contents extends EventEmitter { constructor() { super(); this.mainFrame = { url: 'chatapp://app/index.html' }; this.sent = []; } focus() { this.focused = true; } getURL() { return this.mainFrame.url; } isDestroyed() { return false; } send(channel, state) { this.sent.push({ channel, state }); } setWindowOpenHandler() {} }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(); this.visible = false; windows.push(this); }
    getBounds() { return this.bounds || this.options; } setIgnoreMouseEvents(ignore) { this.ignoresMouse = ignore; (this.mouseModes ||= []).push(ignore); } setMenu() {} setAlwaysOnTop() {} setBounds(value) { this.bounds = value; this.resizeCount = (this.resizeCount || 0) + 1; } isDestroyed() { return !!this.destroyed; } isVisible() { return this.visible; } hide() { this.visible = false; } showInactive() { this.visible = true; } loadFile() { return Promise.resolve(); } destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const ipc = new EventEmitter(); ipc.handlers = new Map(); ipc.handle = (key, handler) => ipc.handlers.set(key, handler); ipc.removeHandler = key => ipc.handlers.delete(key);
  const main = Object.assign(new EventEmitter(), { getBounds: () => ({ x: 0, y: 0, width: 900, height: 800 }), isMinimized: () => false, isDestroyed: () => false, isFocused: () => true, show() {}, focus() { this.focused = true; } });
  const screen = Object.assign(new EventEmitter(), { cursor: {x:0,y:0}, getCursorScreenPoint() { return this.cursor; }, getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) });
  const controller = createRingPopups({ BrowserWindow: Window, screen, ipcMain: ipc, mainWindow: main, uiDir: '/ui', timers, now: () => time });
  const contents = new Contents(); controller.bindContents(contents);
  const publish = (rings, senderFrame = contents.mainFrame) => ipc.emit('chat-rings:publish', { sender: contents, senderFrame }, { rings });
  const tick = milliseconds => { time += milliseconds; for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); } };
  return { controller, contents, windows, publish, tick, ipc, main, jobs, screen };
}
test('native popup works while app focused, ignores untrusted senders, updates room metadata and expires with fade', () => {
  const h = harness(); h.publish([ring()], { url: 'chatapp://app/index.html' }); assert.equal(h.windows.length, 0);
  h.publish([ring()]); const win = h.windows[0]; assert.ok(win); assert.equal(win.options.focusable, true); assert.equal(win.options.acceptFirstMouse, true); assert.equal(win.ignoresMouse, true); assert.equal(win.visible, false);
  win.webContents.emit('did-finish-load'); assert.equal(win.visible, true);
  h.publish([ring({ roomName: 'Renamed', roomIcon: 'data:image/gif;base64,AA==' })]);
  assert.equal(win.webContents.sent.findLast(item => item.channel === 'chat-rings:state').state.rings[0].roomName, 'Renamed');
  h.tick(30000); assert.equal(win.webContents.sent.findLast(item => item.channel === 'chat-rings:state').state.rings.length, 0); assert.equal(win.visible, true);
  h.tick(230); assert.equal(win.visible, false); h.controller.destroy();
});

test('buttons accept answers while the popup body passes through and hover resets outside', () => {
  const h = harness(); h.publish([ring()]); const win = h.windows[0]; win.webContents.emit('did-finish-load');
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal(win.ignoresMouse, true);
  h.ipc.emit('chat-rings:layout', event, [{id:'r1',bounds:{x:6,y:6,width:264,height:170},buttons:[{x:70,y:115,width:54,height:44},{x:134,y:115,width:54,height:44}]}]);
  h.ipc.emit('chat-rings:pointer', event, {x:30,y:30});
  assert.equal(win.ignoresMouse, true);
  assert.deepEqual(win.webContents.sent.at(-1).state,{id:'r1',button:false});
  h.ipc.emit('chat-rings:pointer', event, {x:80,y:125});
  assert.equal(win.ignoresMouse, false);
  assert.deepEqual(win.webContents.sent.at(-1).state,{id:'r1',button:true});
  assert.equal(h.ipc.handlers.get('chat-rings:answer')(event, { action: 'decline', id: 'r1', roomId: 'room1' }), true);
  assert.equal(h.main.focused, undefined, 'declining never foregrounds the main window');
  assert.deepEqual(h.contents.sent.at(-1), { channel: 'chat-rings:command', state: { action: 'decline', id: 'r1', roomId: 'room1' } });
  const accepted = h.ipc.handlers.get('chat-rings:answer')(event, { action: 'join', id: 'r1', roomId: 'room1' });
  assert.equal(accepted, true); assert.equal(h.contents.focused, true);
  assert.equal(win.webContents.sent.findLast(item => item.channel === 'chat-rings:state').state.rings.length, 1, 'delivery alone never hides an unanswered invitation');
  h.publish([]); h.tick(230); assert.equal(win.visible, false);
  h.publish([ring({ id: 'r2', expiresAt: 31230 })]);
  assert.equal(win.visible, true); assert.equal(win.ignoresMouse, true);
  assert.equal(h.ipc.listenerCount('chat-rings:layout'), 1); assert.equal(h.ipc.listenerCount('chat-rings:pointer'), 1);
  h.controller.destroy(); assert.equal(h.jobs.size, 0);
});
test('join/decline actions bind to live ring identity, and navigation/crash removes every old popup', () => {
  const h = harness(); h.publish([ring()]); const win = h.windows[0]; win.webContents.emit('did-finish-load');
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const answer = h.ipc.handlers.get('chat-rings:answer');
  assert.equal(answer({ sender: h.contents, senderFrame: h.contents.mainFrame }, { action: 'decline', id: 'r1', roomId: 'room1' }), false, 'web content cannot impersonate a popup');
  assert.equal(answer({ ...event, senderFrame: {} }, { action: 'decline', id: 'r1', roomId: 'room1' }), false, 'subframes cannot answer');
  assert.equal(answer(event, { action: 'decline', id: 'r1', roomId: 'other-room' }), false, 'room identity is checked as well as invitation identity');
  assert.equal(answer(event, { action: 'delete', id: 'r1', roomId: 'room1' }), false);
  h.ipc.emit('chat-rings:command', event, { action: 'join', id: 'wrong', roomId: 'room1' }); assert.equal(h.main.focused, undefined);
  h.ipc.emit('chat-rings:command', event, { action: 'join', id: 'r1', roomId: 'room1' }); assert.equal(h.main.focused, true);
  assert.deepEqual(h.contents.sent.at(-1), { channel: 'chat-rings:command', state: { action: 'join', id: 'r1', roomId: 'room1' } });
  h.publish([ring({ id: 'r2' })]); h.contents.emit('did-start-navigation', {}, 'chatapp://app/index.html', false, true); assert.equal(win.visible, false);
  h.publish([ring()]); assert.equal(win.visible, false);
  assert.equal(answer(event, { action: 'join', id: 'r1', roomId: 'room1' }), false, 'navigation invalidates outstanding buttons');
  h.contents.emit('did-navigate'); h.publish([ring()]); assert.equal(win.visible, true);
  h.contents.emit('render-process-gone'); assert.equal(win.visible, false);
  h.controller.destroy(); assert.equal(h.ipc.handlers.size, 0); assert.equal(h.jobs.size, 0);
});

test('main-window movement and unchanged ring geometry do not resend icons or resize native surface', () => {
  const h = harness(); h.publish([ring()]); const win = h.windows[0]; win.webContents.emit('did-finish-load');
  const sent = win.webContents.sent.length, resized = win.resizeCount || 0;
  for (let i = 0; i < 60; i++) { h.main.emit('move'); h.main.emit('resize'); }
  assert.equal(win.webContents.sent.length, sent, 'large icons are not cloned on each native move');
  assert.equal(win.resizeCount || 0, resized, 'identical bounds never force Windows compositor updates');
  h.publish([ring({ roomName: 'Live update' })]); assert.equal(win.webContents.sent.length, sent + 1); assert.equal(win.resizeCount || 0, resized);
  h.controller.destroy();
});
