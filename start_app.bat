@echo off
setlocal EnableExtensions

REM Always run from repository root (location of this script)
cd /d "%~dp0"

echo Starting IRMS Dashboard in development mode...

where node.exe >nul 2>&1
if errorlevel 1 (
    echo.
    echo Node.js was not found. Install Node.js 22 or later, then run this launcher again.
    pause
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo.
    echo npm was not found. Repair the Node.js installation, then run this launcher again.
    pause
    exit /b 1
)

REM Ensure dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

REM Start with embedded PostgreSQL storage and automatic free-port selection.
set "APP_LAUNCHED_FROM_BATCH=1"
call npm.cmd run dev:local
set "launcherExitCode=%errorlevel%"

if not "%launcherExitCode%"=="0" (
    echo.
    echo The dashboard stopped with exit code %launcherExitCode%.
    echo Review the error above. This window will stay open so it can be copied.
    pause
    exit /b %launcherExitCode%
)

echo.
echo The launcher finished normally.
echo If the dashboard was already running, its browser page has been opened.
echo If you stopped the development server, it is now safe to close this window.
pause
endlocal
