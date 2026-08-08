@echo off
setlocal EnableExtensions

REM Always run from the repository root (location of this script).
cd /d "%~dp0"

set "P2L_APP_ROOT=%~dp0"
set "P2L_KILL_SCRIPT=%~f0"
set "P2L_KILL_DRY_RUN=0"
if /i "%~1"=="/dry-run" set "P2L_KILL_DRY_RUN=1"

echo Stopping P2L Dashboard processes...
if "%P2L_KILL_DRY_RUN%"=="1" echo Dry run: no processes will be stopped.

REM Use PowerShell for reliable process-tree and command-line matching.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = [IO.Path]::GetFullPath($env:P2L_APP_ROOT).TrimEnd('\');" ^
  "$rootPattern = [regex]::Escape($root);" ^
  "$killScriptPattern = [regex]::Escape($env:P2L_KILL_SCRIPT);" ^
  "$markerPattern = '(?i)(start_app\.bat|start-local\.ps1|scripts[\\/](dev|backend-start)\.bat|dev-start\.ps1|npm.*run\s+dev|next.*\s+dev|node_modules[\\/].*next|uvicorn(\.exe)?\b)';" ^
  "$runtimeNames = @('cmd.exe', 'powershell.exe', 'pwsh.exe', 'node.exe', 'python.exe', 'py.exe');" ^
  "$processes = @(Get-CimInstance Win32_Process);" ^
  "$byId = @{}; foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process };" ^
  "$targets = [Collections.Generic.HashSet[int]]::new();" ^
  "$seeds = @();" ^
  "foreach ($process in $processes) {" ^
  "  $commandLine = [string]$process.CommandLine;" ^
  "  if ([string]::IsNullOrWhiteSpace($commandLine) -or $commandLine -match $killScriptPattern) { continue };" ^
  "  if ($commandLine -match $rootPattern -and $commandLine -match $markerPattern) { $seeds += $process };" ^
  "}" ^
  "$addDescendants = { param([int]$parentId) foreach ($child in $processes) { $childId = [int]$child.ProcessId; if ([int]$child.ParentProcessId -eq $parentId -and $childId -ne $PID) { if ($targets.Add($childId)) { & $addDescendants $childId } } } };" ^
  "$addAppAncestors = { param([int]$childId) $child = $byId[$childId]; while ($null -ne $child) { $parent = $byId[[int]$child.ParentProcessId]; if ($null -eq $parent) { break }; $parentId = [int]$parent.ProcessId; $parentCommandLine = [string]$parent.CommandLine; if ($parentId -eq $PID -or $parentCommandLine -match $killScriptPattern -or $parent.Name -notin $runtimeNames -or $parentCommandLine -notmatch $markerPattern) { break }; if ($targets.Add($parentId)) { $child = $parent } else { break } } };" ^
  "foreach ($seed in $seeds) { $seedId = [int]$seed.ProcessId; if ($seedId -ne $PID) { [void]$targets.Add($seedId); & $addDescendants $seedId; & $addAppAncestors $seedId } };" ^
  "$orderedTargets = @(foreach ($targetId in $targets) { $depth = 0; $cursor = $byId[$targetId]; while ($null -ne $cursor -and $depth -lt 100) { $cursor = $byId[[int]$cursor.ParentProcessId]; $depth++ }; [PSCustomObject]@{ Id = $targetId; Depth = $depth } }) | Sort-Object Depth -Descending;" ^
  "$stopped = 0; $failed = $false;" ^
  "foreach ($target in $orderedTargets) { $process = $byId[[int]$target.Id]; if ($null -eq $process -or $process.Name -in @('conhost.exe', 'OpenConsole.exe', 'WindowsTerminal.exe', 'wt.exe')) { continue }; try { if ($env:P2L_KILL_DRY_RUN -eq '1') { Write-Host ('  Would stop {0} (PID {1})' -f $process.Name, $target.Id) } else { Stop-Process -Id ([int]$target.Id) -Force -ErrorAction Stop; Write-Host ('  Stopped {0} (PID {1})' -f $process.Name, $target.Id) }; $stopped++ } catch { if (Get-Process -Id ([int]$target.Id) -ErrorAction SilentlyContinue) { Write-Warning ('Could not stop {0} (PID {1}): {2}' -f $process.Name, $target.Id, $_.Exception.Message); $failed = $true } } };" ^
  "if ($stopped -eq 0) { Write-Host '  No running P2L Dashboard processes were found.' };" ^
  "if ($failed) { exit 1 }"

set "killExitCode=%errorlevel%"
if not "%killExitCode%"=="0" (
    echo.
    echo Some P2L Dashboard processes could not be stopped. Try running this file as administrator.
    exit /b %killExitCode%
)

if "%P2L_KILL_DRY_RUN%"=="1" (
    echo Dry run complete. No processes were stopped.
) else (
    echo P2L Dashboard processes stopped. You can now run start_app.bat.
)
exit /b 0
