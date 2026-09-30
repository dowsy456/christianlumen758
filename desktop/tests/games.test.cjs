'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { detectGames, parseSteamManifest, createGameActivity, createProcessScanner } = require('../games.cjs');
test('installed Steam games match actual running executables, not launchers or adjacent paths', () => {
  const game = parseSteamManifest('"AppState" { "appid" "105600" "name" "Terraria" "installdir" "Terraria" }', 'D:\\Steam');
  assert.deepEqual(game, { id: 'steam:105600', title: 'Terraria', dir: 'D:\\Steam\\steamapps\\common\\Terraria' });
  assert.equal(parseSteamManifest('"appid" "1" "name" "Bad" "installdir" "..\\outside"', 'D:\\Steam'), null);
  const processes = [
    { name: 'steam.exe', path: 'D:\\Steam\\steam.exe', visible: true },
    { name: 'launcher.exe', path: game.dir + '\\launcher.exe', visible: true },
    { name: 'crashhelper.exe', path: game.dir + '\\crashhelper.exe', visible: true },
    { name: 'other.exe', path: game.dir + '-fake\\game.exe', visible: true },
    { name: 'unlisted.exe', path: game.dir + '\\unlisted.exe', visible: false },
  ];
  assert.deepEqual(detectGames(processes, [game]), []);
  processes.push({ name: 'actual-game.exe', path: game.dir + '\\bin\\actual-game.exe', visible: true });
  assert.deepEqual(detectGames(processes, [game]), [{ id: 'steam:105600', title: 'Terraria' }]);
});
test('known games and Java Minecraft coexist, deduplicate and never expose paths or command lines', () => {
  const result = detectGames([
    { name: 'RobloxPlayerBeta.exe', path: 'C:\\private\\Roblox.exe' }, { name: 'RobloxPlayerBeta.exe' },
    { name: 'javaw.exe', commandLine: 'javaw.exe -cp client.jar net.minecraft.client.main.Main --accessToken PRIVATE' },
    { name: 'javaw.exe', commandLine: 'javaw.exe -jar unrelated.jar' }, { name: 'RiotClientServices.exe' },
  ], []);
  assert.deepEqual(result.map(game => game.title), ['Minecraft', 'Roblox']);
  assert.ok(result.every(game => Object.keys(game).sort().join(',') === 'id,title'));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private|commandLine/);
});
test('native game scanning accepts only its trusted main frame and drops async results after logout/navigation', async () => {
  const ipcMain = new EventEmitter(); ipcMain.handle = () => {}; ipcMain.removeHandler = () => {};
  const mainWindow = new EventEmitter(), timers = { setInterval: () => 1, clearInterval() {} };
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'chatapp://app/index.html' }, getURL: () => 'chatapp://app/index.html', isDestroyed: () => false, sent: [], send(channel, state) { this.sent.push({ channel, state }); } });
  let resolveProcesses, requests = 0;
  const controller = createGameActivity({ ipcMain, mainWindow, timers, platform: 'win32', getInstalls: async () => [], getProcesses: () => { ++requests; return new Promise(resolve => { resolveProcesses = resolve; }); } });
  controller.bindContents(contents);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  ipcMain.emit('chat-games:enabled', { ...event, senderFrame: { url: event.senderFrame.url } }, true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(requests, 0);
  ipcMain.emit('chat-games:enabled', event, true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(requests, 1);
  ipcMain.emit('chat-games:enabled', event, false);
  resolveProcesses([{ name: 'robloxplayerbeta.exe' }]);
  await new Promise(resolve => setImmediate(resolve)); assert.ok(contents.sent.every(message => message.state.games.length === 0), 'late game snapshots never restore a signed-out user');
  contents.emit('did-start-navigation', {}, 'chatapp://app/index.html', false, true);
  ipcMain.emit('chat-games:enabled', event, true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(requests, 1);
  controller.destroy(); assert.equal(ipcMain.listenerCount('chat-games:enabled'), 0);
});

test('one hidden helper serves repeated process snapshots and stops immediately on logout', async () => {
  const children = [];
  function spawnProcess(command, args, options) {
    assert.equal(command, 'powershell.exe'); assert.equal(options.windowsHide, true);
    assert.equal(args[args.length - 2], '-Command');
    assert.equal(args[args.length - 1], '# static packaged script');
    assert.ok(!args.some(arg => /encoded|bypass|executionpolicy/i.test(arg)));
    assert.notEqual(options.shell, true);
    const child = new EventEmitter(); children.push(child);
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} }); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { destroy() { this.destroyed = true; }, write(line) {
      const request = JSON.parse(line);
      if (!request.id) { assert.ok(request.names.includes('robloxplayerbeta.exe')); return; }
      const value = JSON.stringify({ id: request.id, processes: [{ name: 'robloxplayerbeta.exe', path: 'C:\\private\\game.exe' }], scanMs: 3 }) + '\n';
      // Stream framing must survive a JSON response split across reads.
      queueMicrotask(() => { child.stdout.emit('data', value.slice(0, 15)); child.stdout.emit('data', value.slice(15)); });
    } });
    child.kill = () => { child.killed = true; child.emit('exit'); };
    return child;
  }
  const scanner = createProcessScanner({ spawnProcess, readFile: async () => '# static packaged script' });
  for (let i = 0; i < 12; i++) assert.equal((await scanner.read())[0].name, 'robloxplayerbeta.exe');
  assert.equal(children.length, 1, 'twelve scans do not launch twelve PowerShell processes');
  assert.equal(scanner.getDiagnostics().scanMs, 3);
  scanner.stop(); assert.equal(children[0].killed, true); assert.equal(children[0].stdin.destroyed, true);
  await scanner.read(); assert.equal(children.length, 2, 'only a later session restarts the helper'); scanner.stop();
});

test('cancelling scanner startup cannot leak a helper after logout', async () => {
  let finishRead, spawns = 0;
  const scanner = createProcessScanner({ readFile: () => new Promise(resolve => { finishRead = resolve; }), spawnProcess: () => { ++spawns; } });
  const pending = scanner.read(); scanner.stop(); finishRead('# script');
  await assert.rejects(pending, /stopped/); assert.equal(spawns, 0);
});

test('packaged helper contains no runtime compilation or custom native process access', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../helpers/game-process-helper.ps1'), 'utf8');
  assert.doesNotMatch(source, /Add-Type|DllImport|OpenProcess|Invoke-Expression|FromBase64String|ExecutionPolicy/i);
  assert.match(source, /\$process\.MainWindowHandle/);
  assert.match(source, /\$process\.MainModule\.FileName/);
});

test('concurrent scans share one request; a blocked helper cannot automatically respawn', async () => {
  let spawns = 0, child, requests = 0;
  const scanner = createProcessScanner({ readFile: async () => '# script', spawnProcess() {
    ++spawns; child = new EventEmitter();
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} }); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { destroy() {}, write(line) { if (JSON.parse(line).id) ++requests; } });
    child.kill = () => { child.killed = true; child.emit('exit'); };
    return child;
  } });
  const first = scanner.read(), second = scanner.read();
  assert.equal(first, second);
  const rejected = assert.rejects(first, /blocked/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1); child.emit('error', new Error('blocked'));
  await rejected; assert.equal(child.killed, true); assert.equal(scanner.getDiagnostics().failed, true);
  for (let i = 0; i < 12; i++) await assert.rejects(scanner.read(), /blocked/);
  assert.equal(spawns, 1);
  scanner.stop();
  const next = scanner.read(); const stopped = assert.rejects(next, /stopped/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(spawns, 2);
  scanner.stop(); await stopped;
});

test('unresponsive helpers time out once without a timer-driven restart', async () => {
  let timeout, child, spawns = 0, timeoutMs;
  const scanner = createProcessScanner({ readFile: async () => '# script', timers: { setTimeout(fn, ms) { timeout = fn; timeoutMs = ms; return 1; }, clearTimeout() {} }, spawnProcess() {
    ++spawns; child = new EventEmitter();
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} }); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { destroy() {}, write() {} });
    child.kill = () => { child.killed = true; child.emit('exit'); };
    return child;
  } });
  const pending = scanner.read(); const rejected = assert.rejects(pending, /timed out/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(timeoutMs, 12000);
  timeout(); await rejected;
  assert.equal(child.killed, true); await assert.rejects(scanner.read(), /timed out/); assert.equal(spawns, 1);
  scanner.stop();
});

test('failed game activity pauses polling for its session and can recover after explicit re-enable', async () => {
  const ipcMain = new EventEmitter(); ipcMain.handle = () => {}; ipcMain.removeHandler = () => {};
  const mainWindow = new EventEmitter(); let tick, scans = 0, failed = false, cleared = 0;
  const timers = { setInterval(fn) { tick = fn; return 1; }, clearInterval() { ++cleared; } };
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'chatapp://app/index.html' }, getURL: () => 'chatapp://app/index.html', isDestroyed: () => false, sent: [], send(channel, state) { this.sent.push({ channel, state }); } });
  const controller = createGameActivity({ ipcMain, mainWindow, timers, platform: 'win32', getInstalls: async () => [], getProcesses: async () => { ++scans; if (failed) throw new Error('blocked'); return [{ name: 'robloxplayerbeta.exe' }]; } });
  controller.bindContents(contents); const event = { sender: contents, senderFrame: contents.mainFrame };
  ipcMain.emit('chat-games:enabled', event, true); await new Promise(resolve => setImmediate(resolve));
  failed = true; await tick(); const clearCount = cleared;
  assert.deepEqual(contents.sent.at(-1).state.games, []);
  for (let i = 0; i < 12; i++) await tick();
  ipcMain.emit('chat-games:enabled', event, true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(scans, 2); assert.equal(cleared, clearCount);
  ipcMain.emit('chat-games:enabled', event, false); failed = false;
  ipcMain.emit('chat-games:enabled', event, true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(scans, 3); assert.equal(contents.sent.at(-1).state.games[0].title, 'Roblox');
  controller.destroy();
});

test('steady game snapshots cause no repeat renderer IPC and leaving a game publishes once', async () => {
  const ipcMain = new EventEmitter(); ipcMain.handle = () => {}; ipcMain.removeHandler = () => {};
  const mainWindow = new EventEmitter(); let tick, processes = [{ name: 'robloxplayerbeta.exe' }], installationReads = 0;
  const timers = { setInterval(fn) { tick = fn; return 1; }, clearInterval() {} };
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'chatapp://app/index.html' }, getURL: () => 'chatapp://app/index.html', isDestroyed: () => false, sent: [], send(channel, state) { this.sent.push({ channel, state }); } });
  const controller = createGameActivity({ ipcMain, mainWindow, timers, platform: 'win32', getInstalls: async () => { ++installationReads; return []; }, getProcesses: async () => processes });
  controller.bindContents(contents); ipcMain.emit('chat-games:enabled', { sender: contents, senderFrame: contents.mainFrame }, true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(contents.sent.length, 1);
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(contents.sent.length, 1); assert.equal(installationReads, 1);
  processes = []; await tick(); assert.equal(contents.sent.length, 2); assert.deepEqual(contents.sent.at(-1).state.games, []);
  await tick(); assert.equal(contents.sent.length, 2); controller.destroy();
});
