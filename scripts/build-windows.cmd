@echo off
setlocal
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS on the build computer first.
  exit /b 1
)
rem No execution-policy bypass. The CMD entry also works when PS1 execution is disabled.
if exist package-lock.json (call npm ci --no-audit --no-fund) else (call npm install --no-audit --no-fund)
if errorlevel 1 exit /b 1
call npm run build:helpers
if errorlevel 1 exit /b 1
call npm run check
if errorlevel 1 exit /b 1
call npm test
if errorlevel 1 exit /b 1
call npm run test:integration
if errorlevel 1 exit /b 1
call npm run test:desktop
if errorlevel 1 exit /b 1
call npm run dist:win
if errorlevel 1 exit /b 1
node scripts/package-metadata.mjs
if errorlevel 1 exit /b 1
echo Installer and SHA256SUMS are in release/.
endlocal
