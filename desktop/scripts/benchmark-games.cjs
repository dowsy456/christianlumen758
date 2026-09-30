'use strict';
// Repeatable local comparison; prints counts/timings, never process paths or
// command lines. The former implementation is retained only in this benchmark.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createProcessScanner, detectGames } = require('../games.cjs');
const exec = promisify(execFile);
const oldCommand = "$ErrorActionPreference='Stop'; $sessionId=(Get-Process -Id $PID).SessionId; $visible=@{}; Get-Process | ForEach-Object { if ($_.MainWindowHandle -ne 0) { $visible[$_.Id]=$true } }; @(Get-CimInstance Win32_Process -Filter ('SessionId = ' + $sessionId) | ForEach-Object { [PSCustomObject]@{name=$_.Name;path=$_.ExecutablePath;commandLine=$(if ($_.Name -match '^javaw?\\.exe$') {$_.CommandLine} else {''});visible=[bool]$visible[[int]$_.ProcessId]} }) | ConvertTo-Json -Compress";
const stats = values => ({ minMs: +Math.min(...values).toFixed(2), medianMs: +values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(2), maxMs: +Math.max(...values).toFixed(2) });
(async () => {
  if (process.platform !== 'win32') throw new Error('The game process benchmark runs on Windows.');
  const previous = [], current = [], scanner = createProcessScanner(); let beforeCount, afterCount, beforeGames, afterGames, startupMs;
  try {
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', oldCommand], { windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024 });
      previous.push(performance.now() - start); const processes = JSON.parse(stdout || '[]'); beforeCount = processes.length; beforeGames = detectGames(processes, []).map(game => game.title);
    }
    for (let i = 0; i < 7; i++) {
      const start = performance.now(), processes = await scanner.read(), elapsed = performance.now() - start;
      if (i) current.push(elapsed); else startupMs = +elapsed.toFixed(2);
      afterCount = processes.length; afterGames = detectGames(processes, []).map(game => game.title);
    }
    const old = stats(previous), updated = stats(current);
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), previous: { ...old, subprocessesPerSixPolls: 6, candidateCount: beforeCount, games: beforeGames }, updated: { ...updated, startupMs, subprocessesPerSixPolls: 1, candidateCount: afterCount, games: afterGames }, steadyLatencyReductionPercent: +(100 * (1 - updated.medianMs / old.medianMs)).toFixed(1), pollingIntervalMs: 10000 }, null, 2));
  } finally { scanner.stop(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
