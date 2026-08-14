@echo off
setlocal EnableExtensions
title MedyaAtlas APK derle
cd /d "%~dp0"

if /i not "%~1"=="_go" (
  start "MedyaAtlas APK" cmd /k call "%~f0" _go
  exit /b 0
)

call "%~dp0_medyaatlas_paths.bat"
call "%~dp0_flutter_env.bat"

echo.
echo === MedyaAtlas Android APK ===
echo Yerel: %MA_LOCAL%
echo.

where git >nul 2>&1
if not errorlevel 1 (
  if exist "%MA_LOCAL%\.git" (
    git -C "%MA_LOCAL%" fetch origin "%MA_BRANCH%"
    git -C "%MA_LOCAL%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
    git -C "%MA_LOCAL%" reset --hard "origin/%MA_BRANCH%"
  )
)

if exist "%MA_LOCAL%\lib\app_version.dart" (
  cd /d "%MA_LOCAL%"
) else (
  cd /d "%~dp0"
)

if not exist "%FLUTTER%" (
  echo HATA: Flutter yok.
  goto :end
)

echo Flutter: %FLUTTER%
type lib\app_version.dart 2>nul
echo.

set "MA_VER="
for /f "tokens=2 delims='" %%A in ('findstr /C:"appVersion" "lib\app_version.dart"') do set "MA_VER=%%A"
if not defined MA_VER set "MA_VER=0.0.0"

echo [1/2] pub get...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 (
  echo HATA: pub get
  goto :end
)

echo [2/2] flutter build apk --release...
"%ComSpec%" /c call "%FLUTTER%" build apk --release
if errorlevel 1 (
  echo HATA: APK derlenemedi. Android SDK / lisanslar gerekebilir.
  goto :end
)

if not exist "dist" mkdir "dist"
set "OUT=dist\MedyaAtlas.apk"
copy /y "build\app\outputs\flutter-apk\app-release.apk" "%OUT%" >nul
echo.
echo APK hazir (sabit ad):
echo   %CD%\%OUT%
echo.
echo Indirme linki:
echo   https://github.com/alid67-git/MedyaAtlas/releases/latest/download/MedyaAtlas.apk
echo.
explorer "dist"

:end
pause
