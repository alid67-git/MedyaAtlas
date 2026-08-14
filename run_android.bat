@echo off
setlocal EnableExtensions
title MedyaAtlas Android
cd /d "%~dp0"

if /i not "%~1"=="_keep" (
  start "MedyaAtlas Android" /D "%~dp0" cmd /k call "%~f0" _keep
  exit /b 0
)

echo.
echo === MedyaAtlas Android ===
echo Klasor: %CD%
echo.

if exist "%~dp0lib\app_version.dart" (
  echo --- lib\app_version.dart ---
  type "%~dp0lib\app_version.dart"
  echo -----------------------------
  echo.
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
  echo D: surucusu takili degilse C:\src\flutter kullanilir.
  goto :end
)

echo Flutter: %FLUTTER%
echo Engine:  %FLUTTER_PREBUILT_ENGINE_VERSION%
echo.

call "%~dp0_prepare_local_build.bat"

if exist "%~dp0.dart_tool\package_config.json" (
  echo [1/2] pub get atlandi - bagimliliklar hazir.
) else (
  echo [1/2] pub get...
  "%ComSpec%" /c call "%FLUTTER%" pub get
  if errorlevel 1 (
    echo.
    echo UYARI: pub get hata verdi. Google Drive ios\Flutter kilidi olabilir.
    echo Yine de run denenecek.
    echo.
  )
)

echo [2/2] Cihazlar:
"%ComSpec%" /c call "%FLUTTER%" devices
echo.
echo Android baslatiliyor. Telefon: USB debug acik olmali.
echo Emulator de olur. Cikis icin bu pencerede q.
echo.
"%ComSpec%" /c call "%FLUTTER%" run -d android
echo.

:end
echo.
echo Bitti. Bu pencereyi kapatabilirsin.
pause
