@echo off
setlocal EnableExtensions
title MedyaAtlas Android

if /i not "%~1"=="_go" (
  start "MedyaAtlas Android" cmd /k call "%~f0" _go
  exit /b 0
)

call "%~dp0_medyaatlas_paths.bat"
call "%~dp0_flutter_env.bat"

echo.
echo === MedyaAtlas Android ===
echo Yerel repo: %MA_LOCAL%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git yok.
  goto :end
)

set "MA_REMOTE="
for /f "delims=" %%U in ('git -C "%~dp0" remote get-url origin 2^>nul') do set "MA_REMOTE=%%U"
if not defined MA_REMOTE set "MA_REMOTE=%MA_REMOTE_DEFAULT%"

if not exist "C:\src" mkdir "C:\src"
if not exist "%MA_LOCAL%\.git" (
  git clone --branch "%MA_BRANCH%" --single-branch "%MA_REMOTE%" "%MA_LOCAL%"
) else (
  git -C "%MA_LOCAL%" fetch origin "%MA_BRANCH%"
  git -C "%MA_LOCAL%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
  git -C "%MA_LOCAL%" reset --hard "origin/%MA_BRANCH%"
)
if errorlevel 1 (
  echo HATA: %MA_LOCAL% guncellenemedi. Once tasi_c_src.bat calistir.
  goto :end
)

cd /d "%MA_LOCAL%"
type "%MA_LOCAL%\lib\app_version.dart" 2>nul
echo.

if not exist "%FLUTTER%" (
  echo HATA: Flutter bulunamadi.
  goto :end
)

echo Flutter: %FLUTTER%
echo.

call "%MA_LOCAL%\_prepare_local_build.bat"

echo [1/2] pub get...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 echo UYARI: pub get hata verdi; run denenecek.

echo [2/2] Cihazlar:
"%ComSpec%" /c call "%FLUTTER%" devices
echo.
echo Android baslatiliyor. USB debug acik olmali. Cikis: q
echo.
"%ComSpec%" /c call "%FLUTTER%" run -d android

:end
echo.
pause
