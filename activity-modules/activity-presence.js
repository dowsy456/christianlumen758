/* Each app window owns one HTML activity session; popup activities stack. */
(function (App) {
  'use strict';
  function syncSelf(session, items) {
    if (App.htmlActivityStackSession !== session || App.currentUser?.code !== session.code) return;
    const records = { ...(App.currentUser.htmlActivities || {}) };
    if (items?.length) records[session.id] = { updatedAt: Date.now() + (Number(App.firebaseServerTimeOffsetMs) || 0), items };
    else delete records[session.id];
    App.currentUser.htmlActivities = records;
    if (session.versionWritten) App.currentUser.htmlActivitiesVersion = 1;
    const cached = App.liveUserCache?.get(session.code);
    if (cached) { cached.htmlActivities = records; if (session.versionWritten) cached.htmlActivitiesVersion = 1; }
    App.refreshActivityPresenceForUser?.(App.currentUser);
  }
  App.getHtmlActivityStackItems = function () {
    const items = [];
    const current = App.getCurrentHtmlActivityPayload?.();
    if (current) items.push(current);
    if (App.htmlActivityPopupsCode && App.htmlActivityPopupsCode !== App.currentUser?.code) App.htmlActivityPopups.clear();
    for (const [popup, activity] of App.htmlActivityPopups || []) {
      if (popup.closed) App.htmlActivityPopups.delete(popup);
      else items.push(activity);
    }
    const unique = new Map();
    for (const item of items) unique.set(`${item.type}:${item.hubId || item.title}`, item);
    return [...unique.values()].slice(0, 20);
  };
  App.syncHtmlActivityStackPresence = async function () {
    const code = String(App.currentUser?.code || '');
    if (!code || !App.db) return;
    let session = App.htmlActivityStackSession;
    if (session && session.code !== code) {
      App.stopHtmlActivityStackPresence();
      session = null;
    }
    const items = App.getHtmlActivityStackItems();
    if (!session && !items.length) return;
    if (!session) {
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      session = { code, id, ready: false, connected: false, generation: 0, ref: App.db.ref(`users/${code}/htmlActivities/${id}`) };
      App.htmlActivityStackSession = session;
      session.connectionRef = App.db.ref('.info/connected');
      session.connectionCb = snap => {
        if (App.htmlActivityStackSession !== session || App.currentUser?.code !== code) return;
        ++session.generation;
        session.ready = false;
        session.connected = snap.val() === true;
        if (session.connected) void App.syncHtmlActivityStackPresence();
      };
      session.connectionRef.on('value', session.connectionCb);
      session.timer = setInterval(() => { void App.syncHtmlActivityStackPresence(); }, 20000);
    }
    if (!session.connected) return;
    if (session.writing) { session.again = true; return; }
    session.writing = true;
    try {
      const generation = session.generation;
      if (!session.ready) {
        await session.ref.onDisconnect().remove();
        if (App.htmlActivityStackSession !== session || App.currentUser?.code !== code || !session.connected || generation !== session.generation) return;
        session.ready = true;
      }
      if (App.htmlActivityStackSession !== session || App.currentUser?.code !== code || !session.connected) return;
      const next = App.getHtmlActivityStackItems();
      if (next.length && !session.versionWritten) {
        // This durable marker prevents the old compatibility leaf from
        // resurrecting after the final session subtree is removed by Firebase.
        await App.db.ref(`users/${code}/htmlActivitiesVersion`).set(1);
        session.versionWritten = true;
        if (App.htmlActivityStackSession !== session || App.currentUser?.code !== code || !session.connected || generation !== session.generation) return;
      }
      if (next.length) await session.ref.set({ updatedAt: App.firebase.database.ServerValue.TIMESTAMP, items: next });
      else if (session.hadItems) await session.ref.remove();
      session.hadItems = next.length > 0;
      if (App.htmlActivityStackSession !== session) await session.ref.remove();
      else syncSelf(session, next);
    } catch (error) {
      console.warn('HTML activity presence unavailable', error?.code || error?.message);
    } finally {
      session.writing = false;
      if (session.again && App.htmlActivityStackSession === session) {
        session.again = false;
        void App.syncHtmlActivityStackPresence();
      }
    }
  };
  App.trackHtmlActivityPopup = function (popup, game) {
    if (!popup || !game || !App.currentUser) return;
    if ((App.htmlActivityStackSession && App.htmlActivityStackSession.code !== App.currentUser.code) ||
      (App.htmlActivityPopupsCode && App.htmlActivityPopupsCode !== App.currentUser.code)) App.stopHtmlActivityStackPresence();
    App.htmlActivityPopupsCode = App.currentUser.code;
    const title = String(game.hubId ? game.label : game.uploadFileName || game.activityLabel || game.label || 'HTML').trim();
    App.htmlActivityPopups.set(popup, {
      type: game.hubId ? 'hub' : 'upload', title,
      hubId: String(game.hubId || ''), fileName: game.hubId ? '' : title,
      updatedAt: App.firebase.database.ServerValue.TIMESTAMP
    });
    void App.syncHtmlActivityStackPresence();
    App.ensureHtmlActivityPopupTimer();
  };
  App.ensureHtmlActivityPopupTimer = function () {
    if (!App.htmlActivityPopups?.size) return;
    if (!App.htmlActivityPopupTimer) App.htmlActivityPopupTimer = setInterval(() => {
      let changed = false;
      for (const [window] of App.htmlActivityPopups) {
        if (window.closed) { App.htmlActivityPopups.delete(window); changed = true; }
      }
      if (changed) void App.syncHtmlActivityStackPresence();
      if (!App.htmlActivityPopups.size) { clearInterval(App.htmlActivityPopupTimer); App.htmlActivityPopupTimer = null; }
    }, 1000);
  };
  App.stopHtmlActivityStackPresence = function ({ preservePopups = false } = {}) {
    const session = App.htmlActivityStackSession;
    if (session) syncSelf(session, null);
    App.htmlActivityStackSession = null;
    App.htmlActivityStackEpoch = (App.htmlActivityStackEpoch || 0) + 1;
    if (!preservePopups) { App.htmlActivityPopups?.clear(); App.htmlActivityPopupsCode = ''; }
    clearInterval(App.htmlActivityPopupTimer);
    App.htmlActivityPopupTimer = null;
    if (!session) return;
    session.connected = session.ready = false;
    ++session.generation;
    clearInterval(session.timer);
    session.connectionRef.off('value', session.connectionCb);
    // Keep onDisconnect armed if the explicit cleanup cannot reach Firebase.
    void session.ref.remove().then(() => session.ref.onDisconnect().cancel()).catch(() => {});
  };
  App.register('activities/activity-presence', function () {
    App.htmlActivityPopups = new Map();
    App.htmlActivityStackSession = null;
    const sync = App.syncMyHtmlActivityPresence;
    App.syncMyHtmlActivityPresence = async function (...args) {
      const code = App.currentUser?.code, generation = App.accountSessionGeneration, epoch = App.htmlActivityStackEpoch;
      await sync.apply(App, args);
      if (code !== App.currentUser?.code || generation !== App.accountSessionGeneration || epoch !== App.htmlActivityStackEpoch) return;
      await App.syncHtmlActivityStackPresence();
    };
    window.addEventListener('pagehide', event => App.stopHtmlActivityStackPresence({ preservePopups: !!event.persisted }));
    window.addEventListener('pageshow', () => {
      if (App.currentUser) { App.ensureHtmlActivityPopupTimer(); void App.syncHtmlActivityStackPresence(); }
    });
  });
})(globalThis.ChatApp);
