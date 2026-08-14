@echo off
setlocal EnableExtensions
title MedyaAtlas guncelle
cd /d "%~dp0"

set "MA_BRANCH=cursor/recognize-all-media-6bc2"
set "MA_EXPECT=0.6.5"
set "LOCAL_REPO=C:\src\MedyaAtlas"
set "FROM_RUN=0"
if /i "%~1"=="_from_run" set "FROM_RUN=1"

echo.
echo === MedyaAtlas kod guncelle → %LOCAL_REPO% ===
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git yok.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

set "MA_REMOTE="
for /f "delims=" %%U in ('git -C "%~dp0" remote get-url origin 2^>nul') do set "MA_REMOTE=%%U"
if not defined MA_REMOTE set "MA_REMOTE=https://github.com/alid67-git/MedyaAtlas.git"

if not exist "C:\src" mkdir "C:\src"

if not exist "%LOCAL_REPO%\.git" (
  if exist "%LOCAL_REPO%" rmdir /s /q "%LOCAL_REPO%" 2>nul
  git clone --branch "%MA_BRANCH%" --single-branch "%MA_REMOTE%" "%LOCAL_REPO%"
) else (
  git -C "%LOCAL_REPO%" fetch origin "%MA_BRANCH%"
  git -C "%LOCAL_REPO%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
  git -C "%LOCAL_REPO%" reset --hard "origin/%MA_BRANCH%"
)

if errorlevel 1 (
  echo HATA: guncelleme basarisiz.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

echo.
type "%LOCAL_REPO%\lib\app_version.dart" 2>nul
git -C "%LOCAL_REPO%" log -1 --oneline
echo.
echo Tamam. run_windows.bat bundan sonra hep %LOCAL_REPO% kullanir.
if "%FROM_RUN%"=="0" pause
exit /b 0
