'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const isAppURL = url => { try { const u = new URL(url); return u.protocol === 'chatapp:' && u.host === 'app'; } catch { return false; } };
const TRACK_ID = /^[a-zA-Z0-9]{22}$/;
const clean = (value, max = 240) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
function spotifyImage(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && /^(?:i\.scdn\.co|mosaic\.scdn\.co|image-cdn[^.]*\.spotifycdn\.com|i\.spotifycdn\.com)$/.test(u.hostname) ? u.href : ''; } catch { return ''; }
}
function normalizeTrack(value) {
  if (!value?.is_playing || value?.currently_playing_type !== 'track' || value?.item?.is_local) return null;
  const item = value.item, id = clean(item?.id, 22), title = clean(item?.name);
  if (!TRACK_ID.test(id) || !title) return null;
  const artists = (Array.isArray(item.artists) ? item.artists : []).slice(0, 12).map(artist => clean(artist?.name, 120)).filter(Boolean).join(', ');
  return { id, title, artist: artists, album: clean(item.album?.name), image: spotifyImage(item.album?.images?.[0]?.url), url: `https://open.spotify.com/track/${id}` };
}
function readConfig() {
  let value = {};
  try { value = JSON.parse(fs.readFileSync(path.join(__dirname, 'spotify-config.json'), 'utf8')); } catch {}
  return { clientId: process.env.CHAT_APP_SPOTIFY_CLIENT_ID || value.clientId || '', redirectUri: value.redirectUri || 'http://127.0.0.1:43821/spotify/callback' };
}
function validateConfig(raw) {
  const clientId = String(raw?.clientId || '').trim();
  const redirect = new URL(raw?.redirectUri || 'http://127.0.0.1:43821/spotify/callback');
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/spotify/callback') throw new Error('Spotify redirect must be the local /spotify/callback address.');
  return { clientId: /^[a-f\d]{32}$/i.test(clientId) ? clientId : '', redirectUri: redirect.href };
}

// Only the native process ever holds authorization codes, verifiers or tokens.
// A loopback listener is open only during a user-initiated authorization flow.
async function createOAuthRequest(config, { openExternal, timers = globalThis, createServer = http.createServer } = {}) {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const redirect = new URL(config.redirectUri);
  let resolveCode, rejectCode, done = false, timer;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Attach immediately: cancelling while the browser is opening cannot create
  // an unhandled rejection before the caller receives this promise.
  codePromise.catch(() => {});
  const finish = (error, code) => {
    if (done) return;
    done = true; timers.clearTimeout(timer); server.close(); server.closeIdleConnections?.();
    if (error) rejectCode(error); else resolveCode(code);
  };
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    let url;
    try { url = new URL(request.url, redirect.origin); } catch { response.writeHead(400); response.end('Invalid request.'); return; }
    if (request.method !== 'GET' || url.pathname !== redirect.pathname) { response.writeHead(404); response.end('Not found.'); return; }
    const supplied = url.searchParams.get('state') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(state))) { response.writeHead(400); response.end('Invalid Spotify authorization state. Return to Chat App and try again.'); return; }
    if (done) { response.writeHead(410); response.end('This authorization request has finished.'); return; }
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code || code.length > 4096) {
      response.writeHead(400); response.end('Spotify connection was cancelled. You can return to Chat App.');
      finish(new Error('Spotify connection was cancelled.')); return;
    }
    response.end('Spotify authorization received. You can return to Chat App.');
    finish(null, code);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(redirect.port || 0), '127.0.0.1', resolve); });
    redirect.port = String(server.address().port);
    timer = timers.setTimeout(() => finish(new Error('Spotify connection timed out. Try connecting again.')), 180000);
    timer?.unref?.();
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: redirect.href, scope: 'user-read-currently-playing', state, code_challenge_method: 'S256', code_challenge: challenge }).toString();
    await openExternal(url.href);
    return { codePromise, verifier, redirectUri: redirect.href, cancel: () => finish(new Error('Spotify connection was cancelled.')) };
  } catch (error) { finish(new Error(error.code === 'EADDRINUSE' ? 'Spotify connection is already open in another app window. Try again after closing it.' : 'Could not open Spotify sign-in. Try again.')); throw error; }
}

function createSpotifyConnection({ ipcMain, mainWindow, shell, safeStorage, userData, fetchImpl = globalThis.fetch, config = readConfig(), timers = globalThis, now = Date.now, oauthFactory = createOAuthRequest }) {
  let settings;
  try { settings = validateConfig(config); } catch { settings = { clientId: '', redirectUri: '' }; }
  let contents, subscriptions = [], disposed = false, navigating = false, generation = 0, accountCode = '', tokens = null, track = null, error = '', connecting = false, pollTimer, activeFlow;
  const handlers = [];
  const configured = () => !!settings.clientId && safeStorage.isEncryptionAvailable();
  const snapshot = () => ({ accountCode, configured: configured(), connected: !!tokens, connecting, track, error });
  const valid = event => !disposed && !navigating && contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame && isAppURL(event.senderFrame?.url) && isAppURL(contents.getURL());
  const send = () => { if (contents && !contents.isDestroyed() && !navigating) contents.send('chat-spotify:state', snapshot()); };
  const filename = code => path.join(userData, `spotify-${crypto.createHash('sha256').update(code).digest('hex')}.bin`);
  const current = token => token === generation && !disposed && !!accountCode;
  function save() {
    if (!tokens || !accountCode || !configured()) return;
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(filename(accountCode), safeStorage.encryptString(JSON.stringify({ ...tokens, clientId: settings.clientId })), { mode: 0o600 });
  }
  function read(code) {
    if (!configured()) return null;
    try {
      const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(filename(code))));
      if (value.clientId !== settings.clientId || typeof value.refreshToken !== 'string' || !value.refreshToken || typeof value.accessToken !== 'string') return null;
      return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: Number(value.expiresAt) || 0 };
    } catch { return null; }
  }
  function stop() { ++generation; timers.clearTimeout(pollTimer); pollTimer = null; activeFlow?.cancel(); activeFlow = null; connecting = false; }
  function clear() { stop(); accountCode = ''; tokens = null; track = null; error = ''; send(); }
  async function setUser(value) {
    const code = typeof value === 'string' && value.length <= 128 && !/[\u0000-\u001f]/.test(value) ? value : '';
    if (code === accountCode) return snapshot();
    clear(); accountCode = code;
    if (code) tokens = read(code);
    send(); if (tokens) void poll(generation);
    return snapshot();
  }
  async function rekeyUser(value) {
    const from = String(value?.from || ''), to = String(value?.to || '');
    if (!from || from !== accountCode || !/^[A-Z0-9_-]{1,20}$/.test(to)) return false;
    if (from === to) return true;
    // Credentials never cross the preload bridge. Only the active local
    // connection may move its encrypted file after the web account commits.
    const saved = tokens || read(from);
    stop();
    if (saved) {
      fs.mkdirSync(userData, { recursive: true });
      const destination = filename(to), temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify({ ...saved, clientId: settings.clientId })), { mode: 0o600 });
        fs.renameSync(temporary, destination);
        try { fs.unlinkSync(filename(from)); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      } finally { try { fs.unlinkSync(temporary); } catch {} }
    }
    accountCode = to; tokens = saved; error = ''; send();
    if (tokens) void poll(generation);
    return true;
  }
  const request = (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
  async function exchange(body, token) {
    const response = await request('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: settings.clientId, ...body }).toString() });
    if (!current(token)) return false;
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        tokens = null; track = null;
        try { fs.unlinkSync(filename(accountCode)); } catch {}
      }
      throw new Error('Spotify authorization expired or could not be renewed. Try connecting again.');
    }
    const value = await response.json();
    if (!current(token)) return false;
    if (typeof value.access_token !== 'string' || !value.access_token || !(value.refresh_token || tokens?.refreshToken)) throw new Error('Spotify did not finish authorization. Try again.');
    tokens = { accessToken: value.access_token, refreshToken: value.refresh_token || tokens.refreshToken, expiresAt: now() + Math.max(60, Number(value.expires_in) || 3600) * 1000 };
    try { save(); } catch { tokens = null; throw new Error('Windows could not securely save your Spotify connection. Try again.'); }
    return true;
  }
  async function poll(token) {
    if (!current(token) || !tokens || connecting) return;
    let delay = 5000;
    try {
      if (tokens.expiresAt <= now() + 60000 && !await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, token)) return;
      if (!current(token) || !tokens) return;
      let response = await request('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
      if (!current(token)) return;
      if (response.status === 401) {
        if (!await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, token)) return;
        response = await request('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
        if (!current(token)) return;
      }
      if (response.status === 429) { delay = Math.max(5000, (Number(response.headers.get('retry-after')) || 30) * 1000); throw new Error('Spotify is limiting requests. Listening status will resume automatically.'); }
      if (response.status === 403) { delay = 60000; throw new Error('Spotify access is unavailable for this account. The app owner may need to allow your Spotify account.'); }
      if (response.status !== 204 && !response.ok) { delay = 30000; throw new Error('Spotify is temporarily unavailable. Listening status will resume automatically.'); }
      const next = response.status === 204 ? null : normalizeTrack(await response.json());
      if (!current(token)) return;
      const changed = JSON.stringify(next) !== JSON.stringify(track) || error;
      track = next; error = ''; if (changed) send();
    } catch (failure) {
      if (!current(token)) return;
      delay = Math.max(delay, 15000); track = null;
      error = /^Spotify|^Windows/.test(failure.message) ? failure.message : 'Spotify is temporarily unavailable. Listening status will resume automatically.';
      send();
    } finally {
      if (current(token) && tokens) { timers.clearTimeout(pollTimer); pollTimer = timers.setTimeout(() => void poll(token), Math.min(delay, 2147483647)); pollTimer?.unref?.(); }
    }
  }
  async function connect() {
    if (!accountCode) return snapshot();
    if (!configured()) { error = settings.clientId ? 'Secure Spotify storage is unavailable on this computer.' : 'Spotify connections have not been configured for this app yet.'; send(); return snapshot(); }
    if (connecting || tokens) return snapshot();
    stop(); const token = generation; connecting = true; error = ''; send();
    try {
      const flow = await oauthFactory(settings, { openExternal: url => shell.openExternal(url), timers });
      if (!current(token)) { flow.cancel(); return snapshot(); }
      activeFlow = flow;
      const code = await flow.codePromise;
      if (!current(token)) return snapshot();
      await exchange({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier }, token);
      if (!current(token)) return snapshot();
      connecting = false; activeFlow = null; send(); void poll(token);
    } catch (failure) {
      if (current(token)) { connecting = false; activeFlow = null; error = /^Spotify|^Windows/.test(failure.message) ? failure.message : 'Could not connect Spotify. Try again.'; send(); }
    }
    return snapshot();
  }
  async function disconnect() {
    stop(); track = null; tokens = null; error = '';
    if (accountCode) { try { fs.unlinkSync(filename(accountCode)); } catch (failure) { if (failure.code !== 'ENOENT') error = 'Spotify stopped sharing, but Windows could not remove the saved connection. Please try Disconnect again.'; } }
    send(); return snapshot();
  }
  async function openTrack(id) {
    if (!TRACK_ID.test(String(id))) return false;
    try { await shell.openExternal(`spotify:track:${id}`); }
    catch { await shell.openExternal(`https://open.spotify.com/track/${id}`); }
    return true;
  }
  function bindContents(next) {
    clear(); for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = []; contents = next; navigating = false;
    if (!next) return;
    const listen = (name, callback) => { next.on(name, callback); subscriptions.push(() => next.removeListener(name, callback)); };
    listen('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { navigating = true; clear(); } });
    listen('did-navigate', () => { navigating = false; });
    listen('render-process-gone', clear);
    listen('destroyed', () => { clear(); contents = null; });
  }
  for (const [name, callback] of [['user', setUser], ['rekey', rekeyUser], ['get', snapshot], ['connect', connect], ['disconnect', disconnect], ['open', openTrack]]) {
    const channel = `chat-spotify:${name}`; handlers.push(channel);
    ipcMain.handle(channel, (event, value) => valid(event) ? callback(value) : null);
  }
  function destroy() { if (disposed) return; clear(); disposed = true; for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = []; for (const channel of handlers) ipcMain.removeHandler(channel); contents = null; mainWindow.removeListener('closed', destroy); }
  mainWindow.on('closed', destroy);
  return { bindContents, clear, destroy };
}
module.exports = { createSpotifyConnection, createOAuthRequest, normalizeTrack, validateConfig };
