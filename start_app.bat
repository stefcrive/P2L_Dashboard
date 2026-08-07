@echo off
setlocal EnableExtensions

REM Always run from repository root (location of this script)
cd /d "%~dp0"

echo Starting IRMS Dashboard in development mode...

REM Ensure dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Failed to install dependencies.
        exit /b 1
    )
)

REM Start with embedded PostgreSQL storage and automatic free-port selection.
call npm run dev:local

endlocal
