@echo off
cd /d "%~dp0"
title MedyaAtlas
echo MedyaAtlas baslatiliyor...
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi. Lutfen Node.js kurun: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Bagimliliklar yukleniyor...
  call npm install
  if errorlevel 1 (
    echo npm install basarisiz.
    pause
    exit /b 1
  )
)

for %%P in (5173 5174 5175) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P .*LISTENING"') do (
    taskkill /F /PID %%A >nul 2>&1
  )
)

start "" /b cmd /c "npm run api"
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5173"

call npm run dev
pause
