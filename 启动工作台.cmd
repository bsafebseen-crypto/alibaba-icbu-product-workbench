@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or later is required.
  pause
  exit /b 1
)

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js 20 or later is required.
  pause
  exit /b 1
)

if not exist "node_modules\exceljs\package.json" goto install_dependencies
if not exist "node_modules\fast-xml-parser\package.json" goto install_dependencies
goto start_workbench

:install_dependencies
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js 20 or later.
  pause
  exit /b 1
)
echo First launch: installing locked dependencies...
call npm ci
if errorlevel 1 (
  echo [ERROR] Dependency installation failed. Check the network and retry.
  pause
  exit /b 1
)

:start_workbench
echo Starting Alibaba ICBU Product Workbench...
echo URL: http://127.0.0.1:54025/
echo Close this window to stop the workbench.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 900; Start-Process 'http://127.0.0.1:54025/'"
node src\server.js

echo.
echo Workbench stopped.
pause
