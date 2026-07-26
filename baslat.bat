@echo off
cd /d "%~dp0"
title MedyaAtlas
echo MedyaAtlas masaustu baslatiliyor...
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi. Lutfen Node.js kurun: https://nodejs.org
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo Python bulunamadi. Lutfen Python 3 kurun: https://www.python.org
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

if not exist "desktop\.deps_ok" (
  echo Python masaustu paketleri yukleniyor...
  python -m pip install -r desktop\requirements.txt -q
  if errorlevel 1 (
    echo pip install basarisiz.
    pause
    exit /b 1
  )
  echo. > "desktop\.deps_ok"
)

for %%P in (5173 5174 5175) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P .*LISTENING"') do (
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo Vite arayuz sunucusu aciliyor...
start "MedyaAtlas-Vite" /b cmd /c "npm run dev"

echo Vite bekleniyor...
powershell -NoProfile -Command "for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } } catch {} ; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo Vite baslamadi. http://localhost:5173 kontrol et.
  pause
  exit /b 1
)

echo Masaustu penceresi aciliyor (tarayici degil^)...
python desktop\main.py --ui http://localhost:5173/

echo.
echo MedyaAtlas kapandi.
pause
