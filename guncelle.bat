@echo off
setlocal EnableExtensions
title MediaAtlas guncelle
cd /d "%~dp0"

call "%~dp0_medyaatlas_paths.bat"

set "FROM_RUN=0"
if /i "%~1"=="_from_run" set "FROM_RUN=1"

echo.
echo === MediaAtlas guncelle → %MA_LOCAL% ===
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git yok.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

set "MA_REMOTE="
for /f "delims=" %%U in ('git -C "%~dp0" remote get-url origin 2^>nul') do set "MA_REMOTE=%%U"
if not defined MA_REMOTE set "MA_REMOTE=%MA_REMOTE_DEFAULT%"

if not exist "C:\src" mkdir "C:\src"

if not exist "%MA_LOCAL%\.git" (
  if exist "%MA_LOCAL%" rmdir /s /q "%MA_LOCAL%" 2>nul
  git clone --branch "%MA_BRANCH%" --single-branch "%MA_REMOTE%" "%MA_LOCAL%"
) else (
  git -C "%MA_LOCAL%" remote set-url origin "%MA_REMOTE%" 2>nul
  git -C "%MA_LOCAL%" fetch origin "%MA_BRANCH%"
  git -C "%MA_LOCAL%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
  git -C "%MA_LOCAL%" reset --hard "origin/%MA_BRANCH%"
)

if errorlevel 1 (
  echo HATA: guncelleme basarisiz.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

echo.
type "%MA_LOCAL%\lib\app_version.dart" 2>nul
git -C "%MA_LOCAL%" log -1 --oneline
echo.
echo Tamam. Calisma yeri: %MA_LOCAL%
if "%FROM_RUN%"=="0" (
  call "%MA_LOCAL%\kisayol_olustur.bat" _silent 2>nul
  pause
)
exit /b 0
