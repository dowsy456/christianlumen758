/* Desktop game detection publishes only game names, never process paths.
 * Session-owned records let multiple PCs coexist without clearing each other. */
(function (App) {
  "use strict";
  const TTL = 90000;
  const currentTime = () => App.appPresenceNow?.() || Date.now();
  App.getUserGameActivities = function (user) {
    const games = new Map(), now = currentTime();
    for (const session of Object.values(user?.gameActivitySessions || {})) {
      const updatedAt = Number(session?.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > now + TTL || now - updatedAt >= TTL) continue;
      for (const game of Array.isArray(session.games) ? session.games.slice(0, 16) : []) {
        const title = String(game?.title || '').trim().slice(0, 120);
        if (title) games.set(title.toLowerCase(), { id: String(game.id || title).slice(0, 120), title });
      }
    }
    return [...games.values()].sort((a, b) => a.title.localeCompare(b.title));
  };
  App.getUserHtmlActivities = function (user) {
    // A migrated account keeps this marker after its last session disappears.
    // Do not resurrect the older global activity left by a crashed old client.
    if (!user?.htmlActivities) return user?.htmlActivitiesVersion === 1 ? [] : [App.getUserHtmlActivity(user)].filter(Boolean);
    const now = currentTime(), source = Array.isArray(user.htmlActivities) ? user.htmlActivities : Object.values(user.htmlActivities).flatMap(session => {
      const updatedAt = Number(session?.updatedAt);
      return Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt <= now + TTL && now - updatedAt < TTL && Array.isArray(session.items) ? session.items : [];
    });
    const activities = new Map();
    for (const raw of source.slice(0, 64)) {
      const activity = App.getUserHtmlActivity({ htmlActivity: raw });
      if (activity) activities.set([activity.type, activity.hubId, activity.title].join('|'), activity);
    }
    return [...activities.values()];
  };
  const observedUsers = new Map();
  let expiryTimer = null, expiryQueued = false;
  App.getActivityPresenceRenderKey = user => JSON.stringify([
    App.getUserHtmlActivities(user).map(activity => [activity.type, activity.title, activity.hubId, activity.fileName]),
    App.getUserGameActivities(user).map(activity => [activity.id, activity.title]),
    ...(App.getUserSpotifyTrack ? [App.getUserSpotifyTrack(user)] : [])
  ]);
  const nextExpiry = user => {
    let deadline = Infinity;
    const now = currentTime();
    for (const field of ['gameActivitySessions', 'htmlActivities', 'spotifySessions']) {
      if (Array.isArray(user?.[field])) continue;
      for (const session of Object.values(user?.[field] || {})) {
        const stamp = Number(session?.updatedAt);
        if (stamp > 0 && stamp <= now + TTL && stamp + TTL > now) deadline = Math.min(deadline, stamp + TTL);
      }
    }
    return deadline;
  };
  function scheduleExpiry() {
    if (expiryQueued) return;
    expiryQueued = true;
    queueMicrotask(() => {
      expiryQueued = false;
      clearTimeout(expiryTimer); expiryTimer = null;
      let next = Infinity;
      for (const [code, record] of observedUsers) {
        const user = App.currentUser?.code === code ? App.currentUser : App.liveUserCache?.get(code);
        if (!user) { observedUsers.delete(code); continue; }
        next = Math.min(next, nextExpiry(user));
      }
      if (Number.isFinite(next)) expiryTimer = setTimeout(expireActivities, Math.max(1, next - currentTime() + 1));
    });
  }
  function expireActivities() {
    let changed = false, profileChanged = false;
    for (const [code, record] of observedUsers) {
      const user = App.currentUser?.code === code ? App.currentUser : App.liveUserCache?.get(code);
      if (!user) { observedUsers.delete(code); continue; }
      const key = App.getActivityPresenceRenderKey(user);
      if (key === record.key) continue;
      record.key = key; changed = true;
      if (App.userProfileOpen && App.userProfilePinnedCode === code) profileChanged = true;
    }
    if (changed) App.renderOnlineIndicator?.();
    if (profileChanged) App.refreshOpenUserProfileCard?.();
    scheduleExpiry();
  }
  // Called by profile listeners to move the expiry deadline without repainting
  // on every remote heartbeat. Only a real activity change needs a DOM update.
  App.observeActivityPresenceUser = function (user) {
    if (!user?.code) return;
    observedUsers.set(user.code, { key: App.getActivityPresenceRenderKey(user) });
    scheduleExpiry();
  };
  App.refreshActivityPresenceForUser = function (user) {
    if (!user?.code) return;
    const key = App.getActivityPresenceRenderKey(user);
    const previous = observedUsers.get(user.code)?.key || '[[],[]]';
    App.observeActivityPresenceUser(user);
    if (key === previous) return;
    App.renderOnlineIndicator?.();
    if (App.userProfileOpen && App.userProfilePinnedCode === user.code) App.refreshOpenUserProfileCard?.();
  };
  function syncSelf(session, payload) {
    if (App.gamePresenceSession !== session || App.currentUser?.code !== session.code) return;
    const records = { ...(App.currentUser.gameActivitySessions || {}) };
    if (payload) records[session.id] = { games: payload.games, updatedAt: currentTime() }; else delete records[session.id];
    App.currentUser.gameActivitySessions = records;
    const cached = App.liveUserCache?.get(session.code);
    if (cached) cached.gameActivitySessions = records;
    App.refreshActivityPresenceForUser(App.currentUser);
  }
  App.writeGamePresence = async function () {
    const session = App.gamePresenceSession;
    if (!session || !session.ready || !session.connected) return;
    if (session.writing) { session.again = true; return; }
    session.writing = true;
    try {
      const games = App.desktopDetectedGames || [];
      const key = JSON.stringify(games);
      // Native scans may report the same processes. Only changes and a live
      // lease heartbeat require a write; an idle account needs no game writes.
      if (session.lastPublishedKey === key && (!games.length || Date.now() - session.lastWriteAt < 25000)) return;
      const payload = games.length ? { games, updatedAt: App.firebase.database.ServerValue.TIMESTAMP } : null;
      await session.ref.set(payload);
      if (App.gamePresenceSession !== session) { await session.ref.remove(); return; }
      session.lastPublishedKey = key; session.lastWriteAt = Date.now();
      syncSelf(session, payload);
    } catch (error) { console.warn('Game presence unavailable', error?.code || 'offline'); }
    finally { session.writing = false; if (session.again && App.gamePresenceSession === session) { session.again = false; void App.writeGamePresence(); } }
  };
  App.armGamePresence = async function (session) {
    if (!session || App.gamePresenceSession !== session || !session.connected || session.ready || session.arming) return;
    const generation = session.generation;
    session.arming = true;
    try {
      await session.ref.onDisconnect().remove();
      if (App.gamePresenceSession !== session || !session.connected || generation !== session.generation) return;
      session.ready = true; session.lastPublishedKey = null; await App.writeGamePresence();
    } catch (error) { console.warn('Game presence registration unavailable', error?.code || 'offline'); }
    finally { session.arming = false; }
  };
  App.startGamePresence = function () {
    const bridge = window.chatDesktopGames, code = String(App.currentUser?.code || '');
    if (!bridge || !code || !App.db || App.gamePresenceSession?.code === code) return;
    App.stopGamePresence();
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const session = { code, id, ref: App.db.ref(`users/${code}/gameActivitySessions/${id}`), generation: 0, connected: false, ready: false };
    App.gamePresenceSession = session;
    session.connectionRef = App.db.ref('.info/connected');
    session.connectionCb = snap => { if (App.gamePresenceSession !== session) return; ++session.generation; session.ready = false; session.connected = snap.val() === true; if (session.connected) void App.armGamePresence(session); };
    session.connectionRef.on('value', session.connectionCb);
    session.heartbeat = setInterval(() => { if (!session.ready) void App.armGamePresence(session); else void App.writeGamePresence(); }, 25000);
    bridge.setEnabled(true);
    void bridge.getSnapshot().then(value => { if (App.gamePresenceSession === session) App.acceptDesktopGames(value); }).catch(() => {});
  };
  App.stopGamePresence = function () {
    const session = App.gamePresenceSession;
    App.gamePresenceSession = null; App.desktopDetectedGames = [];
    window.chatDesktopGames?.setEnabled(false);
    if (!session) return;
    session.ready = false; session.connected = false; ++session.generation;
    clearInterval(session.heartbeat); session.connectionRef.off('value', session.connectionCb);
    session.ref.remove().then(() => session.ref.onDisconnect().cancel()).catch(() => {});
  };
  App.acceptDesktopGames = function (value) {
    if (!App.gamePresenceSession) return;
    const games = (Array.isArray(value?.games) ? value.games : []).slice(0, 16).map(game => ({ id: String(game?.id || '').slice(0, 120), title: String(game?.title || '').trim().slice(0, 120) })).filter(game => game.title).sort((a, b) => a.title.localeCompare(b.title));
    if (JSON.stringify(games) === JSON.stringify(App.desktopDetectedGames || [])) return;
    App.desktopDetectedGames = games;
    void App.writeGamePresence();
  };
  App.register('chat/game-presence', function () {
    const getActivities = App.getUserActivityItems;
    App.getUserActivityItems = function (user) {
      return [...getActivities(user).filter(item => item.kind !== 'html'), ...App.getUserHtmlActivities(user).map(activity => ({ kind: 'html', label: `Playing ${activity.title}`, activity })), ...App.getUserGameActivities(user).map(activity => ({ kind: 'game', label: `Playing ${activity.title}`, activity }))];
    };
    // Game entries deliberately reuse the HTML activity's icon, spacing and
    // profile row styling, and coexist with HTMLs and schedule indicators.
    const start = App.startAppPresence, stop = App.stopAppPresence;
    App.startAppPresence = function (...args) { const result = start.apply(this, args); App.startGamePresence(); return result; };
    App.stopAppPresence = function (...args) { App.stopGamePresence(); return stop.apply(this, args); };
    window.chatDesktopGames?.onChange(App.acceptDesktopGames);
    window.addEventListener('pagehide', App.stopGamePresence);
    window.addEventListener('pageshow', () => { if (App.currentUser) App.startGamePresence(); });
    // A single deadline handles stale devices. Idle/no-game clients have no
    // repaint interval; heartbeat snapshots only reschedule this deadline.
  });
})(globalThis.ChatApp);
