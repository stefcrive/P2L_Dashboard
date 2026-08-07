# Quick development start script
Write-Host "Starting IRMS Dashboard Development Environment..." -ForegroundColor Green

# Clean install to fix any dependency issues
Write-Host "Cleaning and reinstalling dependencies..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules"
}
if (Test-Path "frontend/node_modules") {
    Remove-Item -Recurse -Force "frontend/node_modules"
}

npm install

# Rebuild shared package
Write-Host "Building shared package..." -ForegroundColor Yellow
npm run build:shared

# Clear Next.js cache
Write-Host "Clearing Next.js cache..." -ForegroundColor Yellow
if (Test-Path "frontend/.next") {
    Remove-Item -Recurse -Force "frontend/.next"
}

Write-Host "Starting development server..." -ForegroundColor Green
npm run dev:frontend