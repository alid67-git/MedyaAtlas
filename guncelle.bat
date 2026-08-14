@echo off
setlocal EnableExtensions
title MedyaAtlas guncelle
cd /d "%~dp0"

set "MA_BRANCH=cursor/recognize-all-media-6bc2"

echo.
echo === MedyaAtlas kod guncelle ===
echo Klasor: %CD%
echo Dal: %MA_BRANCH%
echo.
echo Bu komut yerel degisiklikleri atar ve GitHub'daki son koda gecer.
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git bulunamadi.
  pause
  exit /b 1
)

git fetch origin "%MA_BRANCH%"
if errorlevel 1 (
  echo HATA: fetch basarisiz.
  pause
  exit /b 1
)

git checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
git reset --hard "origin/%MA_BRANCH%"
if errorlevel 1 (
  echo HATA: reset basarisiz. Google Drive kilidi olabilir.
  pause
  exit /b 1
)

echo.
echo --- app_version.dart ---
if exist "%~dp0lib\app_version.dart" type "%~dp0lib\app_version.dart"
echo.
git log -1 --oneline
echo.
echo Tamam. Simdi run_windows.bat'a cift tikla. Baslikta v0.6.4+ olmali.
echo.
pause
