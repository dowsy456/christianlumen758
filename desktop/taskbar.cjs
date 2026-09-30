'use strict';

const path = require('node:path');
const COMMAND_CHANNEL = 'chat-call:command';

// Windows owns the thumbnail toolbar. The app publishes only call state; all
// commands go back to the existing web call handlers for one source of truth.
function createCallTaskbar({ mainWindow, nativeImage, getContents, platform = process.platform, log = () => {} }) {
  let state = null;
  let signature = '';
  let disposed = false;
  const icons = new Map();
  const icon = name => {
    if (!icons.has(name)) icons.set(name, nativeImage.createFromPath(path.join(__dirname, 'assets', 'call-controls', `${name}.png`)));
    return icons.get(name);
  };
  function update(nextState, force = false) {
    state = nextState;
    if (disposed || platform !== 'win32' || mainWindow.isDestroyed()) return;
    const active = !!(state?.active && state.roomId && state.sessionId);
    const controls = state?.controls || {};
    const key = JSON.stringify([active, state?.roomId, state?.sessionId, !!controls.muted, !!controls.deafened, !!controls.listenOnly, state?.enabled !== false]);
    if (!force && signature === key) return;
    const roomId = state?.roomId, sessionId = state?.sessionId;
    const send = action => () => {
      const wc = getContents();
      if (disposed || !state?.active || state.roomId !== roomId || state.sessionId !== sessionId || !wc || wc.isDestroyed()) return;
      if (action === 'mute' && state.controls?.listenOnly) return;
      wc.send(COMMAND_CHANNEL, { action, roomId, sessionId });
    };
    const buttons = active ? [
      { tooltip: controls.listenOnly ? 'Microphone unavailable' : controls.muted ? 'Unmute' : 'Mute', icon: icon(controls.muted || controls.listenOnly ? 'mute-active' : 'mute'), flags: controls.listenOnly ? ['disabled'] : [], click: send('mute') },
      { tooltip: controls.deafened ? 'Undeafen' : 'Deafen', icon: icon(controls.deafened ? 'deafen-active' : 'deafen'), click: send('deafen') },
      { tooltip: state.enabled !== false ? 'Turn Off Call Overlay' : 'Turn On Call Overlay', icon: icon(state.enabled !== false ? 'overlay-active' : 'overlay'), click: send('overlay') },
      { tooltip: 'Leave Call', icon: icon('leave'), flags: ['dismissonclick'], click: send('leave') },
    ] : [];
    try {
      // A false return (for example while Explorer is restarting) must remain
      // retryable on the next state update or window focus/restore.
      if (mainWindow.setThumbarButtons(buttons)) signature = key;
    } catch (error) { log(`Call taskbar controls unavailable: ${error.message}`); }
  }
  const refresh = () => update(state, true);
  mainWindow.on('show', refresh);
  mainWindow.on('restore', refresh);
  mainWindow.on('focus', refresh);
  function destroy() {
    disposed = true;
    for (const event of ['show', 'restore', 'focus']) mainWindow.removeListener(event, refresh);
    state = null;
    icons.clear();
  }
  mainWindow.once('closed', destroy);
  return { update, destroy };
}

module.exports = { createCallTaskbar, COMMAND_CHANNEL };
