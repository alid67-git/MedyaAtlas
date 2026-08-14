@echo off
setlocal EnableExtensions
title MedyaAtlas Windows
cd /d "%~dp0"

if /i not "%~1"=="_keep" (
  start "MedyaAtlas Windows" /D "%~dp0" cmd /k call "%~f0" _keep
  exit /b 0
)

echo.
echo === MedyaAtlas Windows ===
echo Klasor: %CD%
echo.

REM Surum / dal kontrolu — ekranda v0.6.0 goruyorsan bu dal degildir.
if exist "%~dp0lib\app_version.dart" (
  echo --- lib\app_version.dart ---
  type "%~dp0lib\app_version.dart"
  echo -----------------------------
)
where git >nul 2>&1
if not errorlevel 1 (
  git -C "%~dp0" rev-parse --abbrev-ref HEAD 2>nul
  git -C "%~dp0" log -1 --oneline 2>nul
  echo.
)

call "%~dp0_flutter_env.bat"
if not exist "%FLUTTER%" (
  echo HATA: Flutter bulunamadi.
  echo Denenen:
  echo   C:\src\flutter\bin\flutter.bat
  echo   D:\indirilenler\flutter_windows_3.44.8-stable\flutter\bin\flutter.bat
  echo   PATH icindeki flutter
  goto :end
)

echo Flutter: %FLUTTER%
echo Engine:  %FLUTTER_PREBUILT_ENGINE_VERSION%
echo.

call "%~dp0_prepare_local_build.bat"

echo [1/2] pub get...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 (
  echo.
  echo UYARI: pub get hata verdi. Yine de run denenecek.
  echo.
)

echo [2/2] Windows uygulaması baslatiliyor (kaynak koddan)...
echo Baslikta v0.6.3+ gorunmeli. Eski v0.6.0/v0.6.2 ise yanlis klasorden calisiyorsun.
echo Cikis icin bu pencerede q.
echo.
"%ComSpec%" /c call "%FLUTTER%" run -d windows
if errorlevel 1 (
  echo.
  echo HATA: Flutter eklentileri icin Windows Gelistirici Modu lazim
  echo       ^(sembolik baglanti / symlink^).
  echo.
  echo 1. Acilan pencerede "Gelistirici Modu"nu ac.
  echo 2. Bu pencereyi kapat, run_windows.bat'a tekrar cift tikla.
  echo.
  start ms-settings:developers
)
echo.

:end
echo.
echo Bitti. Bu pencereyi kapatabilirsin.
pause
