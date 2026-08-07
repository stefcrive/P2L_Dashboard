@echo off
echo Setting up IRMS Dashboard...

REM Install Node.js dependencies
echo Installing Node.js dependencies...
call npm install

REM Set up Python virtual environment for backend
echo Setting up Python backend environment...
cd backend

if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment and install dependencies
echo Activating virtual environment and installing Python dependencies...
call venv\Scripts\activate
pip install -r requirements.txt
call venv\Scripts\deactivate

cd ..

REM Build shared package
echo Building shared package...
call npm run build:shared

echo.
echo Setup completed successfully!
echo.
echo To start development:
echo   npm run dev
echo.
echo To activate Python environment manually:
echo   cd backend
echo   venv\Scripts\activate
echo.
echo To build for production:
echo   npm run build

pause