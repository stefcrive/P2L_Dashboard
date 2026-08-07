$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$databaseDirectory = Join-Path $repositoryRoot '.local-data\app-postgres'
New-Item -ItemType Directory -Force -Path $databaseDirectory | Out-Null
$env:APP_DATABASE_MODE = 'local'
$env:APP_DATABASE_PATH = $databaseDirectory

$escapedRepositoryRoot = [regex]::Escape($repositoryRoot)
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
    Write-Host "P2L Dashboard is already running at http://localhost:$existingPort."
    exit 0
}

$port = 3000..3010 |
    Where-Object {
        -not (Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue)
    } |
    Select-Object -First 1

if ($null -eq $port) {
    throw 'No free application port was found between 3000 and 3010.'
}

Write-Host 'Embedded PostgreSQL storage is ready. No Docker service is required.'
Write-Host "Starting P2L Dashboard at http://localhost:$port."
npm.cmd run dev --workspace=@irms/frontend -- --port $port
