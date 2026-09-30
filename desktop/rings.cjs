'use strict';
const path = require('node:path');
const { isAppURL } = require('./overlay.cjs');
const FADE_MS = 200;
function normalizeRings(value, now = Date.now()) {
  const rooms = new Set();
  return (Array.isArray(value?.rings) ? value.rings : []).slice(0, 64).flatMap(ring => {
    if (!ring || typeof ring.id !== 'string' || !ring.id || ring.id.length > 256 || typeof ring.roomId !== 'string' || !ring.roomId || ring.roomId.length > 256 || rooms.has(ring.roomId)) return [];
    const expiresAt = Number(ring.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 31000) return [];
    rooms.add(ring.roomId);
    const image = typeof ring.roomIcon === 'string' ? ring.roomIcon : '';
    const finite = (number, fallback, low, high) => Number.isFinite(Number(number)) ? Math.min(high, Math.max(low, Number(number))) : fallback;
    return [{ id: ring.id, roomId: ring.roomId, roomName: String(ring.roomName || 'Room').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180),
      roomIcon: image.length <= 10 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml)(?:;[a-z0-9=._-]+)*,/i.test(image) ? image : '',
      roomIconTransform: { x: finite(ring.roomIconTransform?.x, 0, -100, 100), y: finite(ring.roomIconTransform?.y, 0, -100, 100), scale: finite(ring.roomIconTransform?.scale, 1, .2, 100) }, expiresAt }];
  });
}
function ringBounds(display, count) {
  const area = display.workArea || display.bounds;
  const width = Math.min(276, area.width), height = Math.min(Math.max(1, count) * 180 + 12, 552, Math.floor(area.height * .6));
  return { x: area.x + area.width - width - Math.min(12, Math.max(0, area.width - width)), y: area.y + 12, width, height };
}
function createRingPopups({ BrowserWindow, screen, ipcMain, mainWindow, uiDir, timers = globalThis, now = Date.now, log = () => {} }) {
  let contents = null, win = null, ready = false, disposed = false, navigating = false, rings = [], expiryTimer, hideTimer, geometryTimer, layoutCount = 0, requestedBounds, paintedRings;
  let contentSubscriptions = [], hitRegions = [], pointerTimer = null, ignored = null, hoverKey = '';
  const subscriptions = [];
  let lastBounds = mainWindow.getBounds();
  const listen = (emitter, event, callback, list = subscriptions) => { emitter.on(event, callback); list.push(() => emitter.removeListener(event, callback)); };
  const validApp = event => !disposed && !navigating && contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame && isAppURL(event.senderFrame?.url) && isAppURL(contents.getURL());
  const focused = () => !mainWindow.isDestroyed() && !mainWindow.isMinimized() && mainWindow.isFocused();
  const validPopup = event => !disposed && win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  const visibility = () => { if (contents && !contents.isDestroyed()) contents.send('chat-rings:visibility', { focused: focused() }); };
  function setPointer(point) {
    if (!win || win.isDestroyed()) return;
    const contains = box => point && point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height;
    const region = hitRegions.find(item => rings.some(ring => ring.id === item.id) && contains(item.bounds));
    const button = !!region?.buttons.some(contains);
    const ignore = !button;
    if (ignored !== ignore) { ignored = ignore; win.setIgnoreMouseEvents(ignore, { forward: true }); }
    const key = `${region?.id || ''}:${button}`;
    if (ready && key !== hoverKey) { hoverKey = key; win.webContents.send('chat-rings:hover', { id: region?.id || '', button }); }
  }
  function pollPointer() {
    timers.clearTimeout(pointerTimer); pointerTimer = null;
    if (disposed || !win || win.isDestroyed() || !win.isVisible() || !rings.length) return;
    const cursor = screen.getCursorScreenPoint(), bounds = win.getBounds();
    setPointer({ x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    // Mouse forwarding wakes the buttons immediately; polling also restores
    // opacity after crossing the click-through window's outside edge.
    pointerTimer = timers.setTimeout(pollPointer, 16); pointerTimer?.unref?.();
  }
  function createWindow() {
    layoutCount = rings.length;
    const bounds = ringBounds(screen.getDisplayMatching(lastBounds), layoutCount);
    requestedBounds = bounds; paintedRings = null;
    win = new BrowserWindow({ ...bounds, title: 'Chat App Incoming Calls', show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true, alwaysOnTop: true, focusable: true, acceptFirstMouse: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      webPreferences: { preload: path.join(uiDir, 'rings-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, spellcheck: false } });
    const created = win;
    created.setMenu(null);
    created.setAlwaysOnTop(true, 'screen-saver');
    hitRegions = []; ignored = true; hoverKey = '';
    created.setIgnoreMouseEvents(true, { forward: true });
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.on('will-attach-webview', event => event.preventDefault());
    created.webContents.once('did-finish-load', () => { if (win === created) { ready = true; sync(); } });
    created.webContents.on('render-process-gone', () => { if (win === created) { clear(true); created.destroy(); } });
    created.once('closed', () => { if (win === created) { win = null; ready = false; } });
    created.loadFile(path.join(uiDir, 'rings.html')).catch(error => { log(`Incoming calls UI failed: ${error.message}`); if (!created.isDestroyed()) created.destroy(); });
  }
  function fitWindow() {
    if (!win || win.isDestroyed()) return;
    const target = ringBounds(screen.getDisplayMatching(lastBounds), layoutCount);
    if (!requestedBounds || ['x', 'y', 'width', 'height'].some(key => requestedBounds[key] !== target[key])) {
      requestedBounds = target; win.setBounds(target, false);
    }
  }
  function sync() {
    if (disposed) return;
    timers.clearTimeout(expiryTimer);
    const remaining = rings.filter(ring => ring.expiresAt > now());
    if (remaining.length !== rings.length) rings = remaining;
    if (rings.length) {
      expiryTimer = timers.setTimeout(sync, Math.max(1, Math.min(...rings.map(ring => ring.expiresAt)) - now()));
      expiryTimer?.unref?.();
    }
    if (!win || win.isDestroyed()) { if (rings.length) createWindow(); return; }
    timers.clearTimeout(hideTimer);
    // Native move/resize events only affect geometry; retransmitting large room
    // icons on every such event needlessly serializes them into the renderer.
    if (ready && paintedRings !== rings) { paintedRings = rings; win.webContents.send('chat-rings:state', { rings }); }
    if (rings.length) {
      if (rings.length >= layoutCount) {
        timers.clearTimeout(geometryTimer); geometryTimer = null; layoutCount = rings.length;
      } else if (!geometryTimer) {
        // A removed bottom card still occupies its old row while fading out.
        // Delay shrinking the native surface so its last frame is not clipped.
        geometryTimer = timers.setTimeout(() => {
          geometryTimer = null; layoutCount = rings.length;
          if (rings.length) fitWindow();
        }, FADE_MS + 30);
      }
      fitWindow();
      if (ready && !win.isVisible()) win.showInactive();
      if (ready) pollPointer();
    } else {
      timers.clearTimeout(pointerTimer); pointerTimer = null; setPointer(null);
      // Keep the surface alive long enough for each removed card's fade-out.
      hideTimer = timers.setTimeout(() => { if (!rings.length && win && !win.isDestroyed()) win.hide(); }, FADE_MS + 30);
    }
  }
  function clear(immediate = false) {
    rings = []; sync();
    if (immediate && win && !win.isDestroyed()) { timers.clearTimeout(hideTimer); timers.clearTimeout(geometryTimer); geometryTimer = null; layoutCount = 0; win.hide(); }
  }
  listen(ipcMain, 'chat-rings:layout', (event, regions) => {
    if (!validPopup(event) || !Array.isArray(regions)) return;
    const validRect = box => box && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) && box.width > 0 && box.height > 0 && box.width <= 1000 && box.height <= 1000;
    hitRegions = regions.slice(0, 64).filter(item => typeof item?.id === 'string' && validRect(item.bounds) && Array.isArray(item.buttons)).map(item => ({ id: item.id, bounds: item.bounds, buttons: item.buttons.slice(0, 2).filter(validRect) }));
    pollPointer();
  });
  listen(ipcMain, 'chat-rings:pointer', (event, point) => {
    // This synchronous reply completes native hit-test switching before the
    // renderer handles a following mouse-down on Join or Decline.
    event.returnValue = false;
    if (!validPopup(event) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    setPointer(point); event.returnValue = true;
  });
  function bindContents(next) {
    for (const unsubscribe of contentSubscriptions) unsubscribe(); contentSubscriptions = [];
    contents = next; navigating = false; clear(true);
    if (!contents) return;
    listen(contents, 'did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { navigating = true; clear(true); } }, contentSubscriptions);
    listen(contents, 'did-navigate', () => { navigating = false; visibility(); }, contentSubscriptions);
    listen(contents, 'render-process-gone', () => clear(true), contentSubscriptions);
    listen(contents, 'destroyed', () => { contents = null; clear(true); }, contentSubscriptions);
  }
  listen(ipcMain, 'chat-rings:publish', (event, snapshot) => { if (validApp(event)) { rings = normalizeRings(snapshot, now()); sync(); } });
  ipcMain.handle('chat-rings:get-visibility', event => validApp(event) ? { focused: focused() } : { focused: false });
  function handleCommand(event, command) {
    if (!validPopup(event) || !contents || contents.isDestroyed() || navigating) return false;
    if (!['join', 'decline'].includes(command?.action)) return false;
    const ring = rings.find(ring => ring.id === command.id && ring.roomId === command.roomId && ring.expiresAt > now());
    if (!ring) return false;
    contents.send('chat-rings:command', { action: command.action, id: ring.id, roomId: ring.roomId });
    // The app publishes the accepted dismissal immediately. Do not remove a
    // card merely because IPC was sent: a busy join or stale account must leave
    // a live invitation available to answer again.
    if (command.action === 'join') { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); contents.focus(); }
    return true;
  }
  listen(ipcMain, 'chat-rings:command', handleCommand);
  ipcMain.handle('chat-rings:answer', handleCommand);
  for (const event of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) listen(mainWindow, event, visibility);
  for (const event of ['move', 'resize']) listen(mainWindow, event, () => { if (!mainWindow.isMinimized()) { lastBounds = mainWindow.getBounds(); sync(); } });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) listen(screen, event, sync);
  listen(mainWindow, 'closed', destroy);
  function destroy() {
    if (disposed) return; disposed = true;
    timers.clearTimeout(expiryTimer); timers.clearTimeout(hideTimer); timers.clearTimeout(geometryTimer); timers.clearTimeout(pointerTimer);
    for (const unsubscribe of [...subscriptions, ...contentSubscriptions]) unsubscribe();
    ipcMain.removeHandler('chat-rings:get-visibility');
    ipcMain.removeHandler('chat-rings:answer');
    contents = null; rings = [];
    if (win && !win.isDestroyed()) win.destroy(); win = null;
  }
  return { bindContents, clear, destroy };
}
module.exports = { createRingPopups, normalizeRings, ringBounds };
