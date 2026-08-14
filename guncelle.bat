@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "MA_BRANCH=cursor/recognize-all-media-6bc2"
set "FROM_RUN=0"
if /i "%~1"=="_from_run" set "FROM_RUN=1"

if "%FROM_RUN%"=="0" title MedyaAtlas guncelle

echo.
echo === [0] MedyaAtlas kod guncelle ===
echo Klasor: %CD%
echo Dal: %MA_BRANCH%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git bulunamadi.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

git -C "%~dp0" fetch origin "%MA_BRANCH%"
if errorlevel 1 (
  echo HATA: fetch basarisiz.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

git -C "%~dp0" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
git -C "%~dp0" reset --hard "origin/%MA_BRANCH%"
if errorlevel 1 (
  echo HATA: reset basarisiz. Google Drive kilidi olabilir.
  if "%FROM_RUN%"=="0" pause
  exit /b 1
)

echo.
echo --- app_version.dart ---
if exist "%~dp0lib\app_version.dart" type "%~dp0lib\app_version.dart"
echo.
git -C "%~dp0" log -1 --oneline
echo.
echo Guncelleme tamam.
if "%FROM_RUN%"=="0" (
  echo Simdi run_windows.bat yeterli; o zaten bu adimi cagirir.
  echo.
  pause
)
exit /b 0
