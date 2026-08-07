# PowerShell setup script for IRMS Dashboard
Write-Host "Setting up IRMS Dashboard..." -ForegroundColor Green

# Install Node.js dependencies
Write-Host "Installing Node.js dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install Node.js dependencies" -ForegroundColor Red
    exit 1
}

# Build shared package
Write-Host "Building shared package..." -ForegroundColor Yellow
npm run build:shared

# Set up Python virtual environment
Write-Host "Setting up Python backend environment..." -ForegroundColor Yellow
Set-Location backend

if (!(Test-Path "venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate virtual environment and install dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
& "venv\Scripts\Activate.ps1"
pip install -r requirements.txt
deactivate

Set-Location ..

# Copy environment file if it doesn't exist
if (!(Test-Path ".env")) {
    Write-Host "Creating .env file from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
}

Write-Host ""
Write-Host "Setup completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "To start development:" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "To activate Python environment manually:" -ForegroundColor Cyan
Write-Host "  cd backend" -ForegroundColor White
Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host ""
Write-Host "To build for production:" -ForegroundColor Cyan
Write-Host "  npm run build" -ForegroundColor White