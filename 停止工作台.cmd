@echo off
setlocal
cd /d "%~dp0"

if exist ".git" if not exist ".git\config" (
  if exist "..\..\.git\config" if exist "..\..\src\server.js" cd /d "..\.."
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or later is required.
  pause
  exit /b 1
)

choice /c YN /n /m "Stop the local workbench? [Y/N]: "
if not "%errorlevel%"=="1" exit /b 0
node scripts\workbench-launcher.mjs stop
if errorlevel 1 (
  echo [ERROR] The workbench was not stopped. Do not force-close an active publication.
  pause
  exit /b 1
)
pause
