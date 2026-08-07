@echo on
setlocal EnableExtensions EnableDelayedExpansion

echo ==============================================
echo  IRMS Backend - Startup (Windows .bat)
echo ==============================================

REM Move to repo root (this script is in scripts/)
pushd "%~dp0.."
if errorlevel 1 (
  echo [ERROR] Failed to change directory from script path. Aborting.
  goto :end
)
echo [INFO] Working directory: %CD%

REM Select a suitable Python (prefer 3.12 for dependency wheels)
set "PY_CMD=python"

echo [INFO] Checking for Python launcher 'py'...
where py >nul 2>&1
if not errorlevel 1 (
    echo [INFO] 'py' launcher found.
    rem Prefer 3.13 if available, else 3.12
    py -3.13 -c "import sys; print(sys.version)" >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=py -3.13"
        echo [INFO] Using Python 3.13 via 'py' launcher.
    ) else (
        py -3.12 -c "import sys; print(sys.version)" >nul 2>&1
        if not errorlevel 1 (
            set "PY_CMD=py -3.12"
            echo [INFO] Using Python 3.12 via 'py' launcher.
        ) else (
            echo [WARN] Neither Python 3.13 nor 3.12 available via 'py'. Falling back to default 'python'.
        )
    )
) else (
    echo [WARN] 'py' launcher not found. Trying common Python install paths...
    if exist "%LocalAppData%\Programs\Python\Python313\python.exe" set "PY_CMD=%LocalAppData%\Programs\Python\Python313\python.exe"
    if not defined PY_CMD if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PY_CMD=%LocalAppData%\Programs\Python\Python312\python.exe"
)

echo [INFO] Selected interpreter: %PY_CMD%
%PY_CMD% --version

REM Ensure .env exists at repo root (for pydantic-settings)
if exist ".env" (
    echo [INFO] .env found at repo root.
) else (
    echo [WARN] .env not found. You can create one from .env.example if needed.
)

REM Create backend virtual environment if missing
echo [INFO] Ensuring virtual environment exists at backend\venv ...
if not exist "backend\venv" (
    echo [INFO] Creating Python virtual environment - this may take a minute...
    %PY_CMD% -m venv backend\venv
)

REM Activate venv
echo [INFO] Activating virtual environment...
call backend\venv\Scripts\activate
if errorlevel 1 (
    echo [ERROR] Failed to activate virtual environment.
    goto :end
)
python --version

REM Upgrade pip (no-op if already recent)
echo [INFO] Upgrading pip (if needed)...
python -m pip install --upgrade pip setuptools wheel

REM Install backend requirements if FastAPI not present
echo [INFO] Verifying backend dependencies...
python -c "import fastapi" 1>nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing backend Python dependencies...
    pip install -r backend\requirements.txt || goto :deactivate
) else (
    echo [INFO] Dependencies already present.
)

REM Ensure uploads directory exists
if not exist "uploads" (
  echo [INFO] Creating uploads directory...
  mkdir "uploads"
)

echo.
echo [INFO] Starting FastAPI (Uvicorn) on http://localhost:8000 ...
echo        OpenAPI docs: http://localhost:8000/api/v1/docs
echo        Press Ctrl+C to stop.
echo.

REM Run from repo root so .env is picked up; app lives under backend/
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend

:deactivate
REM Deactivate venv on exit
echo [INFO] Shutting down and deactivating virtual environment...
call backend\venv\Scripts\deactivate

:end
popd
endlocal
@echo off
exit /b %ERRORLEVEL%
