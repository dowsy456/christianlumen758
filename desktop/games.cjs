'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { isAppURL } = require('./overlay.cjs');
const exec = promisify(execFile);
const KNOWN = Object.freeze({
  'robloxplayerbeta.exe': 'Roblox', 'minecraft.windows.exe': 'Minecraft', 'fortniteclient-win64-shipping.exe': 'Fortnite',
  'valorant-win64-shipping.exe': 'VALORANT', 'league of legends.exe': 'League of Legends', 'overwatch.exe': 'Overwatch 2',
  'r5apex.exe': 'Apex Legends', 'rocketleague.exe': 'Rocket League', 'cs2.exe': 'Counter-Strike 2', 'dota2.exe': 'Dota 2',
  'gta5.exe': 'Grand Theft Auto V', 'gta5_enhanced.exe': 'Grand Theft Auto V Enhanced', 'rdr2.exe': 'Red Dead Redemption 2',
  'eldenring.exe': 'ELDEN RING', 'cyberpunk2077.exe': 'Cyberpunk 2077', 'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley', 'among us.exe': 'Among Us', 'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail', 'osu!.exe': 'osu!', 'fallguys_client_game.exe': 'Fall Guys',
  'brawlhalla.exe': 'Brawlhalla', 'destiny2.exe': 'Destiny 2', 'bg3.exe': "Baldur's Gate 3", 'bg3_dx11.exe': "Baldur's Gate 3",
});
const ignored = name => /(?:launcher|crash|helper|unins|install|updat|redist|anticheat|easyanticheat|battleye|cef|webview|unitycrash|steamweb)/i.test(name) || ['steam.exe', 'epicgameslauncher.exe', 'battle.net.exe', 'riotclientservices.exe', 'gameoverlayui.exe'].includes(name);
const canonical = value => String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
function detectGames(processes, installs) {
  const found = new Map();
  const installedPaths = (installs || []).map(game => ({ ...game, prefix: canonical(game.dir) + '\\' }));
  for (const process of Array.isArray(processes) ? processes : []) {
    const name = String(process.name || '').toLowerCase();
    if (!name || ignored(name)) continue;
    const executable = canonical(process.path);
    const install = installedPaths.find(game => executable && executable.startsWith(game.prefix) && process.visible !== false);
    let id = install?.id, title = install?.title || KNOWN[name];
    if (!title && ['java.exe', 'javaw.exe'].includes(name) && /(?:net\.minecraft|net\.fabricmc\.loader|cpw\.mods\.(?:modlauncher|bootstraplauncher)|--assetIndex\s+\S+.*--(?:gameDir|assetsDir))/i.test(String(process.commandLine || ''))) title = 'Minecraft';
    if (!title) continue;
    title = String(title).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    id ||= 'game:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
    if (title) found.set(title.toLowerCase(), { id, title });
    if (found.size >= 16) break;
  }
  return [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
}
function parseSteamManifest(text, steamRoot) {
  const get = key => new RegExp('"' + key + '"\\s+"([^"\\r\\n]*)"', 'i').exec(text)?.[1];
  const appid = get('appid'), title = get('name'), directory = get('installdir');
  if (!/^\d+$/.test(appid || '') || !title || !directory || /[\\/:]|^\.+$/.test(directory)) return null;
  return { id: 'steam:' + appid, title, dir: path.win32.join(steamRoot, 'steamapps', 'common', directory) };
}
async function readInstalledGames({ environment = process.env, readFile = fs.readFile, readdir = fs.readdir, run = exec } = {}) {
  const roots = new Set([path.win32.join(environment['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.win32.join(environment.ProgramFiles || 'C:\\Program Files', 'Steam')]);
  try { const { stdout } = await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 4000, maxBuffer: 256 * 1024 }); const registryPath = /SteamPath\s+REG_SZ\s+([^\r\n]+)/i.exec(stdout)?.[1]?.trim(); if (registryPath) roots.add(registryPath); } catch {}
  for (const root of [...roots]) {
    try { const libraries = await readFile(path.win32.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'); for (const entry of libraries.matchAll(/"path"\s+"([^"\r\n]+)"/g)) roots.add(entry[1].replace(/\\\\/g, '\\')); } catch {}
  }
  const games = [];
  for (const root of roots) {
    const folder = path.win32.join(root, 'steamapps');
    try { for (const name of await readdir(folder)) if (/^appmanifest_\d+\.acf$/i.test(name)) { try { const game = parseSteamManifest(await readFile(path.win32.join(folder, name), 'utf8'), root); if (game) games.push(game); } catch {} } } catch {}
  }
  const epic = path.win32.join(environment.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  try { for (const name of await readdir(epic)) if (name.endsWith('.item')) { try { const item = JSON.parse(await readFile(path.win32.join(epic, name), 'utf8')); if (item.InstallLocation && item.DisplayName && item.LaunchExecutable && !item.bIsIncompleteInstall) games.push({ id: 'epic:' + String(item.AppName || name).slice(0, 100), title: item.DisplayName, dir: item.InstallLocation }); } catch {} } } catch {}
  return games;
}
function createProcessScanner({ spawnProcess = spawn, readFile = fs.readFile, timers = globalThis } = {}) {
  let child, starting, inFlight, sequence = 0, buffer = '', generation = 0, lastScanMs = 0, failure;
  const pending = new Map();
  function shutdown(error, failed) {
    ++generation; const previous = child; child = null; starting = null; inFlight = null; buffer = ''; failure = failed ? error : null;
    for (const request of pending.values()) { timers.clearTimeout(request.timer); request.reject(error); } pending.clear();
    if (previous) { previous.stdin.destroy(); previous.kill(); }
  }
  const stop = () => shutdown(new Error('Game scanning stopped.'), false);
  async function start() {
    if (failure) throw failure;
    if (child) return child;
    if (starting) return starting;
    const token = generation;
    starting = (async () => {
      // Read only our fixed packaged source (including app.asar). Pass it as a
      // literal argument: no encoded payload, generated code, shell quoting,
      // script-policy overrides, or renderer-controlled command text.
      const script = await readFile(path.join(__dirname, 'helpers', 'game-process-helper.ps1'), 'utf8');
      if (token !== generation) throw new Error('Game scanning stopped.');
      const process = spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child = process; buffer = '';
      const fail = error => { if (child === process) shutdown(error, true); };
      process.once('error', fail);
      process.once('exit', () => fail(new Error('Game scanner exited.')));
      process.stdin.on('error', fail);
      process.stderr.on('data', () => {}); // Drain without logging process data.
      process.stdout.setEncoding('utf8');
      process.stdout.on('data', chunk => {
        if (child !== process) return;
        buffer += chunk;
        if (buffer.length > 4 * 1024 * 1024) return fail(new Error('Game scanner response exceeded its limit.'));
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (!line) continue;
          let value; try { value = JSON.parse(line); } catch { return fail(new Error('Invalid game scanner response.')); }
          const request = pending.get(value.id); if (!request) continue;
          pending.delete(value.id); timers.clearTimeout(request.timer);
          lastScanMs = Number(value.scanMs) || 0;
          if (value.error || !Array.isArray(value.processes)) { const error = new Error('Game scan failed.'); request.reject(error); fail(error); }
          else request.resolve(value.processes);
        }
      });
      process.stdin.write(JSON.stringify({ names: Object.keys(KNOWN) }) + '\n');
      return process;
    })();
    try { return await starting; }
    catch (error) { if (token === generation) shutdown(error, true); throw error; }
    finally { if (token === generation) starting = null; }
  }
  function read() {
    if (failure) return Promise.reject(failure);
    if (inFlight) return inFlight;
    const request = (async () => {
      const process = await start();
      if (process !== child) throw new Error('Game scanning stopped.');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = timers.setTimeout(() => shutdown(new Error('Game scanner timed out.'), true), 12000); timer?.unref?.();
        pending.set(id, { resolve, reject, timer });
        try { process.stdin.write(JSON.stringify({ id }) + '\n'); }
        catch (error) { shutdown(error, true); }
      });
    })();
    inFlight = request;
    request.then(() => { if (inFlight === request) inFlight = null; }, () => { if (inFlight === request) inFlight = null; });
    return request;
  }
  return { read, stop, getDiagnostics: () => ({ scanMs: lastScanMs, running: !!child, failed: !!failure }) };
}
async function readRunningProcesses() {
  const scanner = createProcessScanner();
  try { return await scanner.read(); } finally { scanner.stop(); }
}
function createGameActivity({ ipcMain, mainWindow, platform = process.platform, timers = globalThis, getProcesses, getInstalls = readInstalledGames, log = () => {} }) {
  const scanner = getProcesses ? null : createProcessScanner({ timers });
  const readProcesses = getProcesses || (() => scanner.read());
  let contents, subscriptions = [], enabled = false, busy = false, failedSession = false, timer, generation = 0, games = [], installs = [], scannedAt = 0, disposed = false, navigating = false;
  const valid = event => !disposed && !navigating && contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame && isAppURL(event.senderFrame?.url) && isAppURL(contents.getURL());
  const send = () => { if (contents && !contents.isDestroyed()) contents.send('chat-games:state', { games }); };
  async function scan() {
    if (!enabled || failedSession || busy || platform !== 'win32') return;
    const token = generation; busy = true;
    try {
      if (!scannedAt || Date.now() - scannedAt > 5 * 60000) { installs = await getInstalls(); scannedAt = Date.now(); }
      const next = detectGames(await readProcesses(), installs);
      if (token === generation && enabled && JSON.stringify(next) !== JSON.stringify(games)) { games = next; send(); }
    } catch (error) { if (token === generation && enabled) {
      // A blocked helper must not become a spawn/scan/AV-rescan loop. Suspend
      // this session until logout/navigation or an explicit disable/re-enable.
      failedSession = true; timers.clearInterval(timer); timer = null; scanner?.stop();
      if (games.length) { games = []; send(); }
      log(`Game activity paused for this session: ${error.code || error.name}`);
    } }
    finally { busy = false; }
  }
  function disable() { enabled = false; failedSession = false; ++generation; timers.clearInterval(timer); timer = null; scanner?.stop(); if (games.length) { games = []; send(); } }
  function setEnabled(value) { if (!value) return disable(); if (enabled || platform !== 'win32') return; enabled = true; ++generation; void scan(); timer = timers.setInterval(scan, 10000); timer?.unref?.(); }
  function bindContents(next) {
    disable(); for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = []; contents = next; navigating = false;
    if (!next) return;
    const listen = (name, callback) => { next.on(name, callback); subscriptions.push(() => next.removeListener(name, callback)); };
    listen('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { navigating = true; disable(); } });
    listen('did-navigate', () => { navigating = false; });
    listen('render-process-gone', disable);
    listen('destroyed', () => { disable(); contents = null; });
  }
  const request = (event, value) => { if (valid(event)) setEnabled(value === true); };
  ipcMain.on('chat-games:enabled', request);
  ipcMain.handle('chat-games:get', event => valid(event) ? { games } : { games: [] });
  function destroy() { if (disposed) return; disable(); disposed = true; for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = []; ipcMain.removeListener('chat-games:enabled', request); ipcMain.removeHandler('chat-games:get'); contents = null; mainWindow.removeListener('closed', destroy); }
  mainWindow.on('closed', destroy);
  return { bindContents, clear: disable, destroy };
}
module.exports = { detectGames, parseSteamManifest, readInstalledGames, readRunningProcesses, createProcessScanner, createGameActivity };
