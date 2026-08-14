@echo off
setlocal EnableExtensions
title MedyaAtlas Windows
cd /d "%~dp0"

if /i not "%~1"=="_keep" (
  start "MedyaAtlas Windows" /D "%~dp0" cmd /k call "%~f0" _keep
  exit /b 0
)

set "MA_BRANCH=cursor/recognize-all-media-6bc2"
set "MA_EXPECT=0.6.4"

echo.
echo === MedyaAtlas Windows ===
echo Klasor: %CD%
echo Beklenen surum: v%MA_EXPECT%  ^|  dal: %MA_BRANCH%
echo.

REM --- Git: dogru dal + son commit ---
where git >nul 2>&1
if errorlevel 1 (
  echo UYARI: git yok. Manuel: git checkout %MA_BRANCH% ^&^& git pull
  echo.
  goto :after_git
)

echo [git] remote guncelleniyor...
git -C "%~dp0" fetch origin "%MA_BRANCH%" 2>nul
if errorlevel 1 (
  echo UYARI: git fetch basarisiz. Internet / remote kontrol et.
) else (
  echo [git] %MA_BRANCH% dalina geciliyor...
  git -C "%~dp0" checkout "%MA_BRANCH%" 2>nul
  if errorlevel 1 (
    echo UYARI: checkout basarisiz. Mevcut dal kullanilacak.
  ) else (
    git -C "%~dp0" pull --ff-only origin "%MA_BRANCH%"
    if errorlevel 1 echo UYARI: git pull basarisiz veya zaten guncel degil.
  )
)

echo.
echo --- git durum ---
git -C "%~dp0" rev-parse --abbrev-ref HEAD 2>nul
git -C "%~dp0" log -1 --oneline 2>nul
echo ----------------
echo.

:after_git
if exist "%~dp0lib\app_version.dart" (
  echo --- lib\app_version.dart ---
  type "%~dp0lib\app_version.dart"
  echo -----------------------------
  findstr /C:"'%MA_EXPECT%'" /C:"\"%MA_EXPECT%\"" "%~dp0lib\app_version.dart" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo UYARI: app_version.dart icinde v%MA_EXPECT% yok.
    echo Yanlis klasor veya eski kod olabilir. Yukaridaki git adimlarini kontrol et.
    echo.
  ) else (
    echo Surum dogrulandi: v%MA_EXPECT%
    echo.
  )
) else (
  echo UYARI: lib\app_version.dart bulunamadi.
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

echo [1/2] pub get ^(video_player / video_player_win dahil^)...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 (
  echo.
  echo UYARI: pub get hata verdi ^(sikca Google Drive kilidi^).
  echo         ephemeral yerel diske alinmaya calisildi; yine de run denenecek.
  echo.
)

echo [2/2] Windows uygulamasi baslatiliyor ^(kaynak koddan^)...
echo Baslikta v%MA_EXPECT% gorunmeli.
echo Impeller kapali ^(video texture icin --no-enable-impeller^).
echo Cikis icin bu pencerede q.
echo.
REM Impeller + video_player_win: "Could not create external texture" / siyah ekran.
"%ComSpec%" /c call "%FLUTTER%" run -d windows --no-enable-impeller
if errorlevel 1 (
  echo.
  echo HATA: Flutter eklentileri icin Windows Gelistirici Modu lazim
  echo       ^(sembolik baglanti / symlink^).
  echo.
  echo 1. Acilan pencerede "Gelistirici Modu"nu ac.
  echo 2. Mumkunse projeyi Google Drive disinda C:\src\MedyaAtlas gibi yerelde tut.
  echo 3. Bu pencereyi kapat, run_windows.bat'a tekrar cift tikla.
  echo.
  start ms-settings:developers
)
echo.

:end
echo.
echo Bitti. Bu pencereyi kapatabilirsin.
pause
