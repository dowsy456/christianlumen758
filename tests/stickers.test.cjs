'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  let timerId = 0;
  const timers = new Map();
  const observers = [];
  const revoked = [];
  const registrations = [];
  function events(target) {
    target.listeners = new Map();
    target.addEventListener = (type, fn) => {
      if (!target.listeners.has(type)) target.listeners.set(type, new Set());
      target.listeners.get(type).add(fn);
    };
    target.removeEventListener = (type, fn) => target.listeners.get(type)?.delete(fn);
    target.fire = (type, values = {}) => {
      const event = { target, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }, ...values };
      for (const fn of target.listeners.get(type) || []) { fn(event); if (event.stopped) break; }
      return event;
    };
    return target;
  }
  let document;
  class Element {
    constructor(tag = 'div') {
      events(this);
      this.tagName = tag.toUpperCase();
      this.dataset = {};
      this.attributes = {};
      this.style = {
        getPropertyValue(name) { return this[name] || ''; },
        setProperty(name, value) { this[name] = value; },
        removeProperty(name) { delete this[name]; }
      };
      this.children = [];
      this.className = '';
      this.hidden = false;
      this.offsetWidth = 174;
      this.offsetHeight = 100;
      this.value = '';
      this.classList = {
        contains: value => this.className.split(/\s+/).includes(value),
        add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
        remove: (...values) => { this.className = this.className.split(/\s+/).filter(v => !values.includes(v)).join(' '); },
        toggle: (value, enabled) => { if (enabled) this.classList.add(value); else this.classList.remove(value); }
      };
    }
    get isConnected() { return this === document.body || !!this.parentElement?.isConnected; }
    set textContent(value) { this._text = value; this.children.forEach(child => { child.parentElement = null; }); this.children = []; }
    get textContent() { return this._text || ''; }
    set innerHTML(value) {
      this.textContent = '';
      this._html = value;
      if (value.includes('sticker-tile-media')) {
        const media = new Element('span'); media.className = 'sticker-tile-media'; this.appendChild(media);
      }
      for (const match of value.matchAll(/data-sticker-menu-action="([^"]+)"/g)) {
        const button = new Element('button');
        button.setAttribute('data-sticker-menu-action', match[1]);
        button.setAttribute('role', 'menuitem');
        this.appendChild(button);
      }
    }
    get innerHTML() { return this._html || ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, next) {
      child.remove();
      const index = next ? this.children.indexOf(next) : this.children.length;
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentElement = this;
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      this.parentElement = null;
    }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const attr = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
      if (attr) return this.getAttribute(attr[1]) === attr[2];
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const result = [];
      const visit = el => { for (const child of el.children) { if (child.matches(selector)) result.push(child); visit(child); } };
      visit(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { left: 20, top: 30, right: 140, bottom: 150, width: 120, height: 120 }; }
  }
  class Video extends Element { constructor() { super('video'); } play() { return Promise.resolve(); } pause() {} }
  document = events({ documentElement: { clientWidth: 390, clientHeight: 700 }, createElement: tag => tag === 'video' ? new Video() : new Element(tag) });
  document.body = new Element('body');
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  const elements = {};
  for (const id of ['sticker-context-menu', 'sticker-popover', 'sticker-grid', 'sticker-popover-status', 'sticker-search', 'btn-stickers', 'btn-sticker-upload', 'sticker-file-input']) {
    const el = new Element(); el.id = id; elements[id] = el; document.body.appendChild(el);
  }
  elements['sticker-popover'].appendChild(elements['sticker-context-menu']);
  elements['sticker-popover'].appendChild(elements['sticker-grid']);
  elements['sticker-context-menu'].hidden = true;
  const window = events({ innerWidth: 390, innerHeight: 700 });
  const app = {
    register: (id, fn) => { if (id !== 'ui/chat-popovers') registrations.push(fn); },
    $: id => elements[id] || null,
    currentUser: { code: 'me' },
    currentRoomId: 'room',
    escapeHtml: value => String(value),
    isVinny: () => false,
    hasAllChunkedFieldParts: () => true,
    readChunkedField: (value, field) => value[field],
    closeEmojiPopover() {}, closeVoicePopover() {}, closeComposerMoreMenu() {},
    getStoredPlace: () => 'room:room',
    db: { ref: () => ({ once: async () => ({ val: () => ({ dataURL: 'data:image/png;base64,AA==' }) }) }) }
  };
  const ctx = vm.createContext({ ChatApp: app, window, document, console, Blob, DOMException, navigator: { connection: {} },
    innerWidth: 390, innerHeight: 700,
    getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', maxWidth: el.style['max-width'] || 'none', maxHeight: el.style['max-height'] || 'none', minWidth: el.style['min-width'] || '0px' }),
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { timers.set(++timerId, { fn, ms: 16 }); return timerId; },
    cancelAnimationFrame: id => timers.delete(id), queueMicrotask,
    HTMLVideoElement: Video,
    IntersectionObserver: class {
      constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); observers.push(this); }
      observe(el) { this.targets.add(el); }
      unobserve(el) { this.targets.delete(el); }
      disconnect() { this.targets.clear(); }
    },
    URL: { createObjectURL: () => 'blob:sticker-' + Math.random(), revokeObjectURL: url => revoked.push(url) },
    fetch: async () => ({ blob: async () => new Blob(['sticker'], { type: 'image/png' }) })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ui/chat-popovers.js'), 'utf8'), ctx);
  for (const file of ['library.js', 'editor.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/stickers', file), 'utf8'), ctx);
  registrations.forEach(fn => fn());
  app.syncStickerSavedUI = () => {};
  const flushTimers = () => { const pending = [...timers]; timers.clear(); pending.forEach(([, t]) => t.fn()); };
  return { app, ctx, elements, document, window, observers, timers, revoked, flushTimers, Element };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const meta = (id = 'one') => ({ id, name: id, nameLower: id, kind: 'image', state: 'ready', creatorCode: 'me', byteSize: 1024, createdAt: 1 });

test('sticker crop allows 50 percent framing while keeping the default at 100 percent', () => {
  const {app} = harness();app.STICKER_OUTPUT_SIZE = 320;
  const defaults = {panX:0,panY:0};app.clampStickerCrop(defaults,640,640);
  assert.equal(defaults.zoom,1);
  const state = {zoom:.5,panX:500,panY:-500};
  const crop = app.clampStickerCrop(state,640,640);
  assert.equal(state.zoom,.5);assert.equal(crop.scale,.25);
  assert.equal(Math.abs(state.panX),0);assert.equal(Math.abs(state.panY),0);
  state.zoom=.1;app.clampStickerCrop(state,640,640);assert.equal(state.zoom,.5);
});

test('cached sticker metadata survives detached history fragments and loads after mount', async () => {
  const { app, document, Element, observers } = harness();
  const row = new Element();
  const bubble = new Element();
  row.appendChild(bubble);
  let subscribed;
  app.watchStickerMeta = (_id, callback) => { subscribed = callback; return () => {}; };
  let reads = 0;
  app.loadStickerAsset = async () => { reads++; return { url: 'blob:history' }; };
  app.renderStickerMessageInto(bubble, row, meta());
  subscribed(meta()); // A cache callback arrives while still in a fragment.
  const button = bubble.querySelector('button');
  assert.equal(button.isConnected, false);
  const observer = observers.find(value => value.targets.has(button));
  assert(observer, 'unmounted history is registered for a later viewport intersection');
  assert.equal(reads, 0);
  document.body.appendChild(row);
  observer.callback([{ target: button, isIntersecting: true }]);
  await flush();
  assert.equal(reads, 1);
  assert.equal(button.querySelector('img').src, 'blob:history');
  assert.equal(button.classList.contains('is-loading'), false);
});

test('sticker metadata retains pending uploads and ignores callbacks after cleanup', () => {
  const { app, document, Element } = harness();
  const row = new Element();
  const bubble = new Element();
  row.appendChild(bubble);
  document.body.appendChild(row);
  let subscribed;
  app.watchStickerMeta = (_id, callback) => { subscribed = callback; return () => {}; };
  app.renderStickerMessageInto(bubble, row, meta());
  const button = bubble.querySelector('button');
  subscribed({ ...meta(), state: 'pending' });
  assert.equal(button.classList.contains('is-deleted'), false);
  assert.equal(button.classList.contains('is-loading'), true);
  row.__stickerUnsubscribe();
  subscribed(meta());
  assert.equal(button.__loadStickerMessage, undefined);
});

test('foreground and prewarm share one asset request and discard stale completion after logout', async () => {
  const { app, revoked } = harness();
  let resolveRead;
  let reads = 0;
  app.db.ref = () => ({ once: () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); } });
  const first = app.loadStickerAsset(meta());
  const second = app.loadStickerAsset(meta());
  assert.equal(reads, 1);
  resolveRead({ val: () => ({ dataURL: 'data:example' }) });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(await app.loadStickerAsset(meta()), a);
  assert.equal(reads, 1);
  const stale = app.loadStickerAsset(meta('stale'));
  app.stickerRuntimeEpoch++;
  resolveRead({ val: () => ({ dataURL: 'data:example' }) });
  await assert.rejects(stale, { name: 'AbortError' });
  assert.equal(revoked.length, 1);
  assert.equal(app.stickerAssetCache.has('stale'), false);
});

test('prewarm loads only eight recent stickers with two concurrent reads and respects Data Saver', async () => {
  const { app, ctx } = harness();
  app.stickerPrewarmWanted = true;
  for (let i = 0; i < 30; i++) { app.savedStickerIds.add(String(i)); app.savedStickerTimes.set(String(i), i); app.stickerLibraryMeta.set(String(i), meta(String(i))); }
  let active = 0;
  let maxActive = 0;
  const ids = [];
  app.loadStickerAsset = async record => { ids.push(record.id); maxActive = Math.max(maxActive, ++active); await flush(); active--; return {}; };
  await app.prewarmStickerAssets();
  assert.equal(maxActive, 2);
  assert.deepEqual(ids.sort(), ['22', '23', '24', '25', '26', '27', '28', '29']);
  ctx.navigator.connection.saveData = true;
  await app.prewarmStickerAssets();
  assert.equal(ids.length, 8);
});

test('prewarm obeys byte budget and stops queuing assets when the account changes', async () => {
  const { app } = harness();
  app.stickerPrewarmWanted = true;
  for (let i = 0; i < 8; i++) { const id = String(i); app.savedStickerIds.add(id); app.stickerLibraryMeta.set(id, { ...meta(id), byteSize: 5 * 1024 * 1024 }); }
  let reads = 0;
  app.loadStickerAsset = async () => { reads++; await flush(); return {}; };
  await app.prewarmStickerAssets();
  assert.equal(reads, 2);
  for (const record of app.stickerLibraryMeta.values()) record.byteSize = 1024;
  reads = 0;
  app.loadStickerAsset = async () => { reads++; app.currentUser = null; await flush(); };
  await app.prewarmStickerAssets();
  assert.equal(reads, 1);
});

test('picker loads its first rows immediately, keeps rendered tiles, and defers distant media', async () => {
  const { app, elements, observers } = harness();
  for (let i = 0; i < 20; i++) app.stickerLibraryMeta.set(String(i), meta(String(i)));
  let reads = 0;
  app.loadStickerAsset = async record => { reads++; return { url: 'blob:' + record.id }; };
  app.renderStickerMenu();
  const originalTiles = [...elements['sticker-grid'].children];
  assert.equal(reads, 6);
  await flush();
  assert.equal(originalTiles[0].querySelector('img').loading, 'eager');
  assert.equal(observers.find(o => o.options.root === elements['sticker-grid']).targets.size, 14);
  app.renderStickerMenu();
  assert.equal(reads, 6);
  assert.deepEqual(elements['sticker-grid'].children, originalTiles);
  const image = originalTiles[0].querySelector('img');
  elements['sticker-search'].value = '0';
  app.renderStickerMenu();
  assert.equal(elements['sticker-grid'].children[0], originalTiles[0]);
  assert.equal(elements['sticker-grid'].children[0].querySelector('img'), image);
});

test('context menu uses shared surface, stays inside viewport, and Escape returns to picker', () => {
  const { app, elements, document, flushTimers } = harness();
  app.stickerPopoverOpen = true;
  const anchor = elements['btn-stickers'];
  const menu = elements['sticker-context-menu'];
  app.openStickerContextMenu(meta(), 389, 699, anchor);
  assert.equal(menu.parentElement, document.body);
  assert.equal(menu.classList.contains('msg-menu'), true);
  assert.equal(menu.classList.contains('open'), true);
  assert.ok(parseInt(menu.style.left) + menu.offsetWidth <= 380);
  assert.ok(parseInt(menu.style.top) + menu.offsetHeight <= 690);
  document.fire('keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement, menu.children[1]);
  document.fire('keydown', { key: 'Escape' });
  assert.equal(app.stickerPopoverOpen, true);
  assert.equal(document.activeElement, anchor);
  assert.equal(menu.classList.contains('closing'), true);
  flushTimers();
  assert.equal(menu.hidden, true);
});

test('account teardown removes retained tiles so revoked image URLs cannot survive into another session', async () => {
  const { app, elements } = harness();
  app.stickerLibraryMeta.set('one', meta());
  app.loadStickerAsset = async () => ({ url: 'blob:old-user' });
  app.renderStickerMenu();
  await flush();
  assert.equal(elements['sticker-grid'].children.length, 1);
  app.teardownStickerRuntime();
  assert.equal(elements['sticker-grid'].children.length, 0);
  assert.equal(app.stickerLibraryMeta.size, 0);
  assert.equal(app.stickerPrewarmWanted, false);
});

test('context menu dismisses on outside click, scrolling and selection, with reopen-safe animation cleanup', () => {
  const { app, elements, document, window, flushTimers } = harness();
  app.stickerPopoverOpen = true;
  const menu = elements['sticker-context-menu'];
  const open = () => app.openStickerContextMenu(meta(), 80, 80);
  open();
  document.fire('pointerdown', { target: menu.children[0] });
  assert.equal(menu.classList.contains('open'), true);
  assert.equal(app.stickerPopoverOpen, true);
  document.fire('pointerdown', { target: elements['sticker-grid'] });
  assert.equal(menu.classList.contains('closing'), true);
  open();
  flushTimers();
  assert.equal(menu.hidden, false);
  document.fire('scroll', { target: elements['sticker-grid'] });
  flushTimers();
  assert.equal(menu.hidden, true);
  let unsaved = '';
  app.unsaveSticker = async id => { unsaved = id; };
  open();
  menu.children[0].fire('click');
  flushTimers();
  assert.equal(unsaved, 'one');
  assert.equal(menu.hidden, true);
  open();
  window.fire('blur');
  assert.equal(menu.hidden, true);
});
