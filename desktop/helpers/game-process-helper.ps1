# One request-driven helper per active desktop session, using this fixed plain
# packaged source. It does no work while stdin is idle and uses only built-in
# read-only process APIs. Raw metadata never leaves the native bridge.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$configuration = [Console]::ReadLine() | ConvertFrom-Json
$known = @{}
foreach ($name in $configuration.names) { $known[[string]$name] = $true }
$currentSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
$metadata = @{}
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        $started = [Diagnostics.Stopwatch]::StartNew()
        $present = @{}
        $result = New-Object 'System.Collections.Generic.List[object]'
        foreach ($process in [Diagnostics.Process]::GetProcesses()) {
            try {
                $name = $process.ProcessName.ToLowerInvariant() + '.exe'
                $java = $name -eq 'java.exe' -or $name -eq 'javaw.exe'
                if ($process.SessionId -ne $currentSession) { continue }
                $shown = $false
                try { $shown = $process.MainWindowHandle -ne [IntPtr]::Zero } catch {}
                if (-not $shown -and -not $known.ContainsKey($name) -and -not $java) { continue }
                # Protected games may deny start-time/path access while their
                # process name is readable. Keep known-name detection working.
                try { $birth = [string]$process.StartTime.ToFileTimeUtc() } catch { $birth = $name }
                $identity = [string]$process.Id + ':' + $birth
                $present[$identity] = $true
                $entry = $metadata[$identity]
                if ($null -eq $entry) {
                    $command = ''
                    # WMI is only needed for a newly seen Java process, never
                    # for an all-process snapshot or a known ordinary game.
                    if ($java) {
                        try { $command = [string](Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $process.Id) -Property CommandLine -OperationTimeoutSec 3).CommandLine } catch {}
                    }
                    # Protected games may deny module metadata; known-name
                    # detection still works without requesting elevated access.
                    $imagePath = ''
                    try { $imagePath = [string]$process.MainModule.FileName } catch {}
                    $entry = @{name=$name;path=$imagePath;commandLine=$command;visible=$shown}
                    $metadata[$identity] = $entry
                }
                $entry.visible = $shown
                $result.Add($entry)
            } catch {} finally { $process.Dispose() }
        }
        foreach ($identity in @($metadata.Keys)) { if (-not $present.ContainsKey($identity)) { $metadata.Remove($identity) } }
        [Console]::WriteLine((@{id=$request.id;processes=@($result.ToArray());scanMs=$started.Elapsed.TotalMilliseconds} | ConvertTo-Json -Depth 5 -Compress))
    } catch {
        [Console]::WriteLine((@{id=$request.id;error='process-scan-failed'} | ConvertTo-Json -Compress))
    }
}
