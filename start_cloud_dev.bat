@echo off
setlocal
cd /d "%~dp0"
node scripts\start-cloud-dev.mjs %*
exit /b %ERRORLEVEL%
