@echo off
setlocal EnableExtensions
title MediaAtlas → C:\src tasi
cd /d "%~dp0"

if /i not "%~1"=="_keep" (
  start "MediaAtlas tasi" /D "%~dp0" cmd /k call "%~f0" _keep
  exit /b 0
)

call "%~dp0_medyaatlas_paths.bat"
call "%~dp0_flutter_env.bat"

echo.
echo === MediaAtlas: Google Drive → %MA_LOCAL% ===
echo.
echo Bu betik:
echo   1. Projeyi %MA_LOCAL% altina clone/gunceller
echo   2. Masaustu + Baslat Menu kisayollari olusturur
echo   3. Drive kopyasini kullanmayi birakir ^(silmek sana kalmis^)
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git bulunamadi. Git for Windows kur.
  goto :end
)

set "MA_REMOTE="
for /f "delims=" %%U in ('git -C "%~dp0" remote get-url origin 2^>nul') do set "MA_REMOTE=%%U"
if not defined MA_REMOTE set "MA_REMOTE=%MA_REMOTE_DEFAULT%"

if not exist "C:\src" mkdir "C:\src"

echo [1/3] %MA_LOCAL% senkron...
if not exist "%MA_LOCAL%\.git" (
  if exist "%MA_LOCAL%" (
    echo Eski klasor var, yedekleniyor: %MA_LOCAL%.eski
    if exist "%MA_LOCAL%.eski" rmdir /s /q "%MA_LOCAL%.eski" 2>nul
    move /y "%MA_LOCAL%" "%MA_LOCAL%.eski" >nul 2>&1
  )
  git clone --branch "%MA_BRANCH%" --single-branch "%MA_REMOTE%" "%MA_LOCAL%"
) else (
  git -C "%MA_LOCAL%" remote set-url origin "%MA_REMOTE%" 2>nul
  git -C "%MA_LOCAL%" fetch origin "%MA_BRANCH%"
  git -C "%MA_LOCAL%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
  git -C "%MA_LOCAL%" reset --hard "origin/%MA_BRANCH%"
)
if errorlevel 1 (
  echo HATA: git senkron basarisiz.
  goto :end
)

echo.
type "%MA_LOCAL%\lib\app_version.dart" 2>nul
git -C "%MA_LOCAL%" log -1 --oneline
echo.

echo [2/3] Kisayollar...
call "%MA_LOCAL%\kisayol_olustur.bat" _silent
if errorlevel 1 (
  echo UYARI: kisayol olusturma kismi basarisiz; elle dene: %MA_LOCAL%\kisayol_olustur.bat
)

echo.
echo [3/3] Explorer aciliyor: %MA_LOCAL%
start "" explorer "%MA_LOCAL%"

echo.
echo === Tamam ===
echo Bundan sonra:
echo   - Masaustundeki "MediaAtlas Windows" kisayolunu kullan
echo   - veya %MA_LOCAL%\run_windows.bat
echo.
echo Google Drive kopyasini ^(MedyaAtlasApp^) artik kullanma.
echo Istegine gore Drive klasorunu sil veya "Arsiv" diye yeniden adlandir.
echo.

:end
pause
