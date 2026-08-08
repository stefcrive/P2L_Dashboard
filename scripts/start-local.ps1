$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$frontendDirectory = Join-Path $repositoryRoot 'frontend'
$nextCacheDirectory = Join-Path $frontendDirectory '.next'
$databaseDirectory = Join-Path $repositoryRoot '.local-data\app-postgres'
New-Item -ItemType Directory -Force -Path $databaseDirectory | Out-Null
$env:APP_DATABASE_MODE = 'local'
$env:APP_DATABASE_PATH = $databaseDirectory

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$TargetProcessId)

    $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $TargetProcessId }
    foreach ($child in $children) {
        Stop-ProcessTree -TargetProcessId ([int]$child.ProcessId)
    }

    Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
}

function Wait-ForApplication {
    param(
        [Parameter(Mandatory = $true)][string]$ReadyUrl,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$ServerProcess,
        [int]$TimeoutSeconds = 180
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $ServerProcess.Refresh()
        if ($ServerProcess.HasExited) {
            return $false
        }

        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $ReadyUrl -TimeoutSec 10
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return $true
            }
        }
        catch {
            # Next.js or the embedded database is still starting.
        }

        Start-Sleep -Milliseconds 500
    }

    return $false
}

$escapedRepositoryRoot = [regex]::Escape($repositoryRoot)
$clearNextCache = $env:P2L_CLEAR_NEXT_CACHE -eq '1'
$existingServer = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -match $escapedRepositoryRoot -and
        $_.CommandLine -match 'next.+dev'
    } |
    Select-Object -First 1

if ($null -ne $existingServer) {
    $existingPort = 3000
    if ($existingServer.CommandLine -match '--port\s+(\d+)') {
        $existingPort = [int]$Matches[1]
    }

    $existingUrl = "http://localhost:$existingPort/api/database/ready"
    $existingServerIsHealthy = $false
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $existingUrl -TimeoutSec 8
        $existingServerIsHealthy = $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    }
    catch {
        $existingServerIsHealthy = $false
    }

    if ($existingServerIsHealthy) {
        Write-Host "P2L Dashboard is already running at http://localhost:$existingPort." -ForegroundColor Green
        if ($env:APP_LAUNCHED_FROM_BATCH -eq '1') {
            Start-Process "http://localhost:$existingPort"
        }
        exit 0
    }

    Write-Warning "A stale dashboard process was found on port $existingPort. Restarting it."
    Stop-ProcessTree -TargetProcessId ([int]$existingServer.ProcessId)
    $clearNextCache = $true
    Start-Sleep -Milliseconds 500
}

$port = 3000..3010 |
    Where-Object {
        -not (Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue)
    } |
    Select-Object -First 1

if ($null -eq $port) {
    throw 'No free application port was found between 3000 and 3010.'
}

if ($clearNextCache -and (Test-Path -LiteralPath $nextCacheDirectory)) {
    Write-Host 'Clearing the Next.js cache after an unhealthy shutdown...'
    Remove-Item -LiteralPath $nextCacheDirectory -Recurse -Force
}

Write-Host 'Starting the dashboard and embedded PostgreSQL database...'
$applicationUrl = "http://localhost:$port"
$readyUrl = "$applicationUrl/api/database/ready"
$serverProcess = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--workspace=@irms/frontend', '--', '--port', "$port") `
    -WorkingDirectory $repositoryRoot `
    -NoNewWindow `
    -PassThru

if (-not (Wait-ForApplication -ReadyUrl $readyUrl -ServerProcess $serverProcess)) {
    $serverProcess.Refresh()
    if ($serverProcess.HasExited) {
        exit $serverProcess.ExitCode
    }
    Stop-ProcessTree -TargetProcessId $serverProcess.Id
    throw 'The dashboard did not become ready within three minutes.'
}

# Compile the shared layout before the browser requests its JavaScript chunks.
Invoke-WebRequest -UseBasicParsing -Uri $applicationUrl -TimeoutSec 120 | Out-Null
Write-Host "P2L Dashboard is ready at $applicationUrl." -ForegroundColor Green
if ($env:APP_LAUNCHED_FROM_BATCH -eq '1') {
    Start-Process $applicationUrl
}

$serverProcess.WaitForExit()
exit $serverProcess.ExitCode
