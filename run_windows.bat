@echo off
setlocal EnableExtensions
title MedyaAtlas Windows
cd /d "%~dp0"

REM Ilk cift tik: ayri cmd penceresi ac.
if /i not "%~1"=="_keep" if /i not "%~1"=="_ready" (
  start "MedyaAtlas Windows" /D "%~dp0" cmd /k call "%~f0" _keep
  exit /b 0
)

set "MA_BRANCH=cursor/recognize-all-media-6bc2"

echo.
echo === MedyaAtlas Windows ===
echo Klasor: %CD%
echo Dal: %MA_BRANCH%
echo.

REM --- _keep: git guncelle, sonra GUNCEL bat ile yeniden basla ---
if /i "%~1"=="_keep" goto :do_git
goto :after_git

:do_git
where git >nul 2>&1
if errorlevel 1 (
  echo UYARI: git yok. Manuel: git fetch ^&^& git checkout %MA_BRANCH% ^&^& git reset --hard origin/%MA_BRANCH%
  echo.
  goto :relaunch
)

echo [git] fetch origin %MA_BRANCH%...
git -C "%~dp0" fetch origin "%MA_BRANCH%"
if errorlevel 1 (
  echo UYARI: git fetch basarisiz.
  echo.
  goto :relaunch
)

echo [git] %MA_BRANCH% = origin ^(zorunlu guncelleme^)...
git -C "%~dp0" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
if errorlevel 1 (
  echo UYARI: checkout basarisiz, reset deneniyor...
  git -C "%~dp0" reset --hard "origin/%MA_BRANCH%"
)
git -C "%~dp0" reset --hard "origin/%MA_BRANCH%"
if errorlevel 1 (
  echo UYARI: reset basarisiz. Yerel dosyalar / Google Drive kilidi olabilir.
) else (
  echo [git] guncel: 
  git -C "%~dp0" log -1 --oneline
)
echo.

:relaunch
echo Guncel bat yeniden baslatiliyor...
echo.
call "%~f0" _ready
exit /b %ERRORLEVEL%

:after_git
echo --- git durum ---
where git >nul 2>&1
if not errorlevel 1 (
  git -C "%~dp0" rev-parse --abbrev-ref HEAD 2>nul
  git -C "%~dp0" log -1 --oneline 2>nul
)
echo ----------------
echo.

set "MA_VER="
if exist "%~dp0lib\app_version.dart" (
  echo --- lib\app_version.dart ---
  type "%~dp0lib\app_version.dart"
  echo -----------------------------
  for /f "tokens=2 delims='" %%A in ('findstr /C:"appVersion" "%~dp0lib\app_version.dart"') do set "MA_VER=%%A"
)
if defined MA_VER (
  echo Surum: v%MA_VER%
  echo.
) else (
  echo UYARI: app_version okunamadi.
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
  echo UYARI: pub get hata verdi ^(sikca Google Drive kilidi^).
  echo         Yine de run denenecek.
  echo.
)

echo [2/2] Windows uygulamasi baslatiliyor...
if defined MA_VER echo Baslikta v%MA_VER% gorunmeli.
echo Impeller kapali ^(video texture^). Cikis: q
echo.
"%ComSpec%" /c call "%FLUTTER%" run -d windows --no-enable-impeller
if errorlevel 1 (
  echo.
  echo HATA: Windows Gelistirici Modu ^(symlink^) veya Google Drive kilidi.
  echo 1. Gelistirici Modu ac.
  echo 2. Mumkunse projeyi C:\src\MedyaAtlas gibi yerel klasore al.
  echo 3. run_windows.bat'a tekrar cift tikla.
  echo.
  start ms-settings:developers
)
echo.

:end
echo.
echo Bitti. Bu pencereyi kapatabilirsin.
pause
