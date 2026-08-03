@echo off
cd /d "%~dp0"
title MedyaAtlas V2
echo MedyaAtlas V2 (web / PWA / telefon) baslatiliyor...
echo.
echo Telefon: ayni Wi-Fi'de asagidaki adresi Safari/Chrome'da ac.
echo Surucu eklemek icin yerel API de acilir.
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

REM Eski dinleyicileri temizle (onceki oturum artigi)
for %%P in (5183 5174) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P .*LISTENING"') do (
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo Yerel API aciliyor (surucu tarama / medya)...
REM Gozcu: API cokerse otomatik yeniden baslar. Pencereyi kapatma.
start "MedyaAtlas-V2-API" /D "%~dp0" cmd /k "npm run api:watch"

echo API bekleniyor...
powershell -NoProfile -Command "for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5174/api/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } } catch {} ; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo Yerel API baslamadi. http://127.0.0.1:5174/api/health kontrol et.
  pause
  exit /b 1
)

set VITE_MEDIAATLAS_EDITION=v2
echo Vite V2 LAN sunucusu (port 5183, --host)...
start "MedyaAtlas-V2-Vite" /D "%~dp0" cmd /k "set VITE_MEDIAATLAS_EDITION=v2&& npm run dev:v2"

echo Vite bekleniyor...
powershell -NoProfile -Command "for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5183/' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } } catch {} ; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo Vite V2 baslamadi. http://127.0.0.1:5183 kontrol et.
  pause
  exit /b 1
)

for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
  set IP=%%A
  goto :gotip
)
:gotip
set IP=%IP: =%
echo.
echo V2 hazir:
echo   PC:      http://127.0.0.1:5183/
echo   Telefon: http://%IP%:5183/
echo   Surucu:  Kaynaklar → + Surucu ekle
echo   Not:     V1 (5173) veya eski sekme kullanma.
echo.
echo API ve Vite AYRI pencerelerde calisiyor (gorev cubugunda iki siyah pencere).
echo Bu baslat penceresini kapatabilirsin; sunucular acik kalir.
echo Durdurmak icin o iki pencereyi kapat veya asagida bir tusa bas (hepsini kapatir).
echo.
echo Tarayici aciliyor...
start "" "http://127.0.0.1:5183/?edition=v2"
echo.
pause >nul

for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":5183 .*LISTENING"') do (
  taskkill /F /PID %%A >nul 2>&1
)
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":5174 .*LISTENING"') do (
  taskkill /F /PID %%A >nul 2>&1
)
