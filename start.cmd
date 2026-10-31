@echo off
setlocal
REM Install dependencies once, then launch Vite on the local network.
REM Access from Android requires HTTPS, not an ordinary HTTP LAN IP.
cd /d "%~dp0"
if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run dev
