@echo off
setlocal EnableExtensions
title MedyaAtlas Windows
cd /d "%~dp0"

REM Ilk cift tik: ayri pencere.
if /i not "%~1"=="_go" (
  start "MedyaAtlas Windows" /D "%~dp0" cmd /k call "%~f0" _go
  exit /b 0
)

set "MA_BRANCH=cursor/recognize-all-media-6bc2"
set "MA_EXPECT=0.6.5"
set "LOCAL_REPO=C:\src\MedyaAtlas"

echo.
echo === MedyaAtlas Windows ===
echo Bu kopya: %CD%
echo Hedef surum: v%MA_EXPECT%
echo Yerel calisma: %LOCAL_REPO%
echo   ^(Google Drive eski dosyayi geri yazmasin diye^)
echo.

call "%~dp0_flutter_env.bat"

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git yok.
  goto :end
)

REM Origin URL — Drive kopyasindan oku, yoksa GitHub.
set "MA_REMOTE="
for /f "delims=" %%U in ('git -C "%~dp0" remote get-url origin 2^>nul') do set "MA_REMOTE=%%U"
if not defined MA_REMOTE set "MA_REMOTE=https://github.com/alid67-git/MedyaAtlas.git"

if not exist "C:\src" mkdir "C:\src"

echo --- Adim 0: %LOCAL_REPO% guncelle ---
if not exist "%LOCAL_REPO%\.git" (
  echo Ilk kurulum: clone %MA_BRANCH% ...
  if exist "%LOCAL_REPO%" rmdir /s /q "%LOCAL_REPO%" 2>nul
  git clone --branch "%MA_BRANCH%" --single-branch "%MA_REMOTE%" "%LOCAL_REPO%"
  if errorlevel 1 (
    echo HATA: clone basarisiz: %MA_REMOTE%
    goto :end
  )
) else (
  git -C "%LOCAL_REPO%" remote set-url origin "%MA_REMOTE%" 2>nul
  git -C "%LOCAL_REPO%" fetch origin "%MA_BRANCH%"
  if errorlevel 1 (
    echo HATA: fetch basarisiz.
    goto :end
  )
  git -C "%LOCAL_REPO%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
  git -C "%LOCAL_REPO%" reset --hard "origin/%MA_BRANCH%"
  if errorlevel 1 (
    echo HATA: reset basarisiz.
    goto :end
  )
)

echo.
git -C "%LOCAL_REPO%" log -1 --oneline
echo.

set "MA_VER="
if exist "%LOCAL_REPO%\lib\app_version.dart" (
  echo --- %LOCAL_REPO%\lib\app_version.dart ---
  type "%LOCAL_REPO%\lib\app_version.dart"
  echo -----------------------------------------
  for /f "tokens=2 delims='" %%A in ('findstr /C:"appVersion" "%LOCAL_REPO%\lib\app_version.dart"') do set "MA_VER=%%A"
)

if /i not "%MA_VER%"=="%MA_EXPECT%" (
  echo.
  echo HATA: Beklenen v%MA_EXPECT%, bulunan v%MA_VER%
  echo GitHub / internet / yanlis repo kontrol et.
  echo.
  goto :end
)

echo Surum dogrulandi: v%MA_VER%
echo.
echo Calisma klasoru: %LOCAL_REPO%
cd /d "%LOCAL_REPO%"

if not exist "%FLUTTER%" (
  echo HATA: Flutter bulunamadi.
  goto :end
)

echo Flutter: %FLUTTER%
echo.

call "%LOCAL_REPO%\_prepare_local_build.bat"

echo [1/2] pub get...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 (
  echo UYARI: pub get hata verdi; run yine denenecek.
  echo.
)

echo [2/2] Windows uygulamasi ^(v%MA_VER%^)...
echo Impeller kapali. Cikis: q
echo.
"%ComSpec%" /c call "%FLUTTER%" run -d windows --no-enable-impeller
if errorlevel 1 (
  echo.
  echo HATA: Gelistirici Modu ^(symlink^) gerekebilir.
  start ms-settings:developers
)

:end
echo.
echo Bitti. Bu pencereyi kapatabilirsin.
pause
