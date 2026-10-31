@echo off
setlocal
REM Build the complete static Vite application into the dist folder.
cd /d "%~dp0"
if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm test
if errorlevel 1 exit /b 1
call npm run build
