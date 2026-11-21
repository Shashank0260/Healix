@echo off
cd /d "%~dp0"
echo Starting Healix...
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.5 or later from https://nodejs.org/
  pause
  exit /b 1
)
node server.js
pause
