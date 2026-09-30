/* Spotify tokens remain inside the desktop process. Firebase receives only
 * public song metadata, on a short, session-owned presence lease. */
(function (App) {
  "use strict";
  const TTL = 90000;
  const now = () => App.appPresenceNow?.() || Date.now();
  App.normalizeSpotifyTrack = function (value) {
    const id = String(value?.id || '');
    if (!/^[a-zA-Z0-9]{22}$/.test(id)) return null;
    const text = (input, limit = 240) => String(input || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
    const title = text(value.title);
    if (!title) return null;
    let image = '';
    try { const url = new URL(value.image); if (url.protocol === 'https:' && !url.username && !url.password && /^(?:i\.scdn\.co|mosaic\.scdn\.co|image-cdn[^.]*\.spotifycdn\.com|i\.spotifycdn\.com)$/.test(url.hostname)) image = url.href; } catch {}
    return { id, title, artist: text(value.artist, 480), album: text(value.album), image, url: `https://open.spotify.com/track/${id}` };
  };
  App.getUserSpotifyTrack = function (user) {
    const timestamp = now();
    const records = Object.values(user?.spotifySessions || {}).filter(record => Number(record?.updatedAt) > 0 && Number(record.updatedAt) <= timestamp + TTL && timestamp - Number(record.updatedAt) < TTL).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    for (const record of records) { const track = App.normalizeSpotifyTrack(record.track); if (track) return track; }
    return null;
  };
  App.spotifyIconMarkup = function (className = '') {
    return `<span class="spotify-activity-icon ${App.escapeAttr(className)}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="11"/><path d="M5.7 9c4-1.3 8.6-.9 12.5 1.3M6.7 12.2c3.4-1 7.2-.7 10.4 1.1M7.6 15.3c2.8-.8 5.9-.5 8.6.9" fill="none" stroke="#132219" stroke-width="1.8" stroke-linecap="round"/></svg></span>`;
  };
  App.spotifyProfileMarkup = function (track) {
    if (!track) return '';
    return `<div class="user-profile-spotify" aria-label="Listening to Spotify">
      <div class="spotify-listening-label">${App.spotifyIconMarkup()}<span>Listening to Spotify</span></div>
      <div class="spotify-track-row">${track.image ? `<img class="spotify-album-art" src="${App.escapeAttr(track.image)}" alt="${App.escapeAttr(track.album || 'Album artwork')}" loading="lazy" referrerpolicy="no-referrer"/>` : '<span class="spotify-album-art spotify-album-placeholder" aria-hidden="true">♪</span>'}
        <div class="spotify-track-copy"><div class="spotify-track-name" title="${App.escapeAttr(track.title)}">${App.escapeHtml(track.title)}</div><div class="spotify-track-artist" title="${App.escapeAttr(track.artist)}">${App.escapeHtml(track.artist)}</div></div>
        <a class="spotify-play" href="${App.escapeAttr(track.url)}" data-spotify-track="${App.escapeAttr(track.id)}" target="_blank" rel="noopener noreferrer" aria-label="Play ${App.escapeAttr(track.title)} on Spotify" title="Play on Spotify"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></a>
      </div></div>`;
  };
  App.renderMemberListeningStatus = function (element, className, user) {
    if (!element) return;
    const track = App.getUserSpotifyTrack(user);
    element.hidden = !className && !track;
    const markup = `${className ? `<span class="member-class-text">${App.escapeHtml(className)}</span>` : ''}${className && track ? '<span class="member-status-separator" aria-hidden="true"> · </span>' : ''}${track ? `<span class="member-spotify-text">${App.spotifyIconMarkup()}<span>${App.escapeHtml(track.title)} · ${App.escapeHtml(track.artist)}</span></span>` : ''}`;
    if (element.__spotifyMarkup !== markup) { element.innerHTML = markup; element.__spotifyMarkup = markup; }
    element.title = [className, track ? `Listening to ${track.title} by ${track.artist}` : ''].filter(Boolean).join(' · ');
    element.classList.toggle('has-spotify', !!track);
  };
  App.spotifyAccountSettingsHTML = function () {
    if (!window.chatDesktopSpotify) return '';
    return `<section class="settings-panel" data-settings-search="Spotify music listening connection account"><div class="settings-panel-title">Spotify</div><div class="settings-panel-sub">Share what you are listening to on your profile. People using the website can see your music too.</div><div class="spotify-account-controls"><button class="btn" id="settings-spotify-connect" type="button">Connect Spotify</button><button class="btn" id="settings-spotify-disconnect" type="button" hidden>Disconnect Spotify</button></div><p class="spotify-account-status" id="settings-spotify-status" role="status" aria-live="polite">Checking your connection…</p></section>`;
  };
  App.renderSpotifyAccountSettings = function () {
    const state = App.desktopSpotifyState, connect = App.$('settings-spotify-connect'), disconnect = App.$('settings-spotify-disconnect'), status = App.$('settings-spotify-status');
    if (!connect || !disconnect || !status) return;
    connect.hidden = !!state?.connected;
    connect.disabled = !state?.configured || !!state?.connecting;
    connect.textContent = state?.connecting ? 'Connecting…' : 'Connect Spotify';
    disconnect.hidden = !state?.connected && !state?.connecting && !state?.error;
    disconnect.textContent = state?.connecting ? 'Cancel connection' : 'Disconnect Spotify';
    status.textContent = state?.error || (!state ? 'Checking your connection…' : !state.configured ? 'Spotify connections are not configured for this app yet.' : state.connecting ? 'Finish connecting in your browser.' : state.connected ? state.track ? `Sharing ${state.track.title} by ${state.track.artist}` : 'Connected. Play a song on Spotify to show it on your profile.' : 'Spotify is not connected.');
  };
  App.bindSpotifyAccountSettings = function () {
    const bridge = window.chatDesktopSpotify;
    if (!bridge) return;
    const connect = App.$('settings-spotify-connect'), disconnect = App.$('settings-spotify-disconnect');
    if (connect) connect.onclick = () => { void bridge.connect().then(App.acceptDesktopSpotify).catch(() => { const status = App.$('settings-spotify-status'); if (status) status.textContent = 'Could not connect Spotify. Try again.'; }); };
    if (disconnect) disconnect.onclick = () => { void bridge.disconnect().then(App.acceptDesktopSpotify).catch(() => { const status = App.$('settings-spotify-status'); if (status) status.textContent = 'Could not disconnect Spotify. Try again.'; }); };
    App.renderSpotifyAccountSettings();
    void bridge.getState().then(App.acceptDesktopSpotify).catch(() => {});
  };
  function syncSelf(session, track) {
    if (App.spotifyPresenceSession !== session || App.currentUser?.code !== session.code) return;
    const records = { ...(App.currentUser.spotifySessions || {}) };
    if (track) records[session.id] = { track, updatedAt: now() }; else delete records[session.id];
    App.currentUser.spotifySessions = records;
    const cached = App.liveUserCache?.get(session.code); if (cached) cached.spotifySessions = records;
    App.refreshActivityPresenceForUser?.(App.currentUser);
  }
  App.writeSpotifyPresence = async function () {
    const session = App.spotifyPresenceSession;
    if (!session?.ready || !session.connected) return;
    if (session.writing) { session.again = true; return; }
    session.writing = true;
    try {
      const track = App.desktopSpotifyState?.connected ? App.normalizeSpotifyTrack(App.desktopSpotifyState.track) : null;
      const key = JSON.stringify(track);
      if (session.lastKey === key && (!track || Date.now() - session.lastWriteAt < 25000)) return;
      await session.ref.set(track ? { track, updatedAt: App.firebase.database.ServerValue.TIMESTAMP } : null);
      if (App.spotifyPresenceSession !== session) { await session.ref.remove(); return; }
      session.lastKey = key; session.lastWriteAt = Date.now(); syncSelf(session, track);
    } catch (failure) { console.warn('Spotify presence unavailable', failure?.code || 'offline'); }
    finally { session.writing = false; if (session.again && App.spotifyPresenceSession === session) { session.again = false; void App.writeSpotifyPresence(); } }
  };
  App.armSpotifyPresence = async function (session) {
    if (!session || App.spotifyPresenceSession !== session || !session.connected || session.ready || session.arming) return;
    const generation = session.generation; session.arming = true;
    try {
      await session.ref.onDisconnect().remove();
      if (App.spotifyPresenceSession !== session || !session.connected || generation !== session.generation) return;
      session.ready = true; session.lastKey = undefined; await App.writeSpotifyPresence();
    } catch (failure) { console.warn('Spotify presence registration unavailable', failure?.code || 'offline'); }
    finally { session.arming = false; }
  };
  App.acceptDesktopSpotify = function (value) {
    const session = App.spotifyPresenceSession;
    if (!session || value?.accountCode !== session.code) return;
    App.desktopSpotifyState = { accountCode: session.code, configured: !!value.configured, connected: !!value.connected, connecting: !!value.connecting, error: String(value.error || '').slice(0, 300), track: App.normalizeSpotifyTrack(value.track) };
    App.renderSpotifyAccountSettings(); void App.writeSpotifyPresence();
  };
  App.startSpotifyPresence = function () {
    const bridge = window.chatDesktopSpotify, code = String(App.currentUser?.code || '');
    if (!bridge || !code || !App.db || App.spotifyPresenceSession?.code === code) return;
    App.stopSpotifyPresence();
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const session = { code, id, ref: App.db.ref(`users/${code}/spotifySessions/${id}`), generation: 0, ready: false, connected: false };
    App.spotifyPresenceSession = session;
    session.connectionRef = App.db.ref('.info/connected');
    session.connectionCb = snapshot => { if (App.spotifyPresenceSession !== session) return; ++session.generation; session.ready = false; session.connected = snapshot.val() === true; if (session.connected) void App.armSpotifyPresence(session); };
    session.connectionRef.on('value', session.connectionCb);
    session.heartbeat = setInterval(() => { if (!session.ready) void App.armSpotifyPresence(session); else void App.writeSpotifyPresence(); }, 25000);
    void bridge.setUser(code).then(App.acceptDesktopSpotify).catch(() => {});
  };
  App.stopSpotifyPresence = function () {
    const session = App.spotifyPresenceSession;
    App.spotifyPresenceSession = null; App.desktopSpotifyState = null;
    if (!App.passwordChangeInFlight) void window.chatDesktopSpotify?.setUser('').catch(() => {});
    if (!session) return;
    session.ready = false; session.connected = false; ++session.generation;
    clearInterval(session.heartbeat); session.connectionRef.off('value', session.connectionCb);
    session.ref.remove().then(() => session.ref.onDisconnect().cancel()).catch(() => {});
  };
  App.register('chat/spotify-presence', function () {
    const activities = App.getUserActivityItems;
    App.getUserActivityItems = function (user) { const track = App.getUserSpotifyTrack(user); return [...activities(user), ...(track ? [{ kind: 'spotify', label: `Listening to ${track.title} by ${track.artist}`, activity: track }] : [])]; };
    const start = App.startAppPresence, stop = App.stopAppPresence;
    App.startAppPresence = function (...args) { const result = start.apply(this, args); App.startSpotifyPresence(); return result; };
    App.stopAppPresence = function (...args) { App.stopSpotifyPresence(); return stop.apply(this, args); };
    window.chatDesktopSpotify?.onChange(App.acceptDesktopSpotify);
    window.addEventListener('pagehide', App.stopSpotifyPresence);
    window.addEventListener('pageshow', () => { if (App.currentUser) App.startSpotifyPresence(); });
    document.addEventListener('click', event => {
      const link = event.target.closest?.('[data-spotify-track]');
      if (!link || !window.chatDesktopSpotify) return;
      event.preventDefault(); event.stopPropagation();
      void window.chatDesktopSpotify.openTrack(link.dataset.spotifyTrack).catch(() => { window.open(link.href, '_blank', 'noopener'); });
    });
    document.addEventListener('error', event => {
      if (event.target?.tagName !== 'IMG' || !event.target.classList.contains('spotify-album-art')) return;
      const fallback = document.createElement('span');
      fallback.className = 'spotify-album-art spotify-album-placeholder'; fallback.textContent = '♪'; fallback.setAttribute('aria-hidden', 'true');
      event.target.replaceWith(fallback);
    }, true);
  });
})(globalThis.ChatApp);
