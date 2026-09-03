@echo off
setlocal EnableExtensions
title MedyaAtlas Windows zip derle
cd /d "%~dp0"

if /i not "%~1"=="_go" (
  start "MedyaAtlas Windows zip" cmd /k call "%~f0" _go
  exit /b 0
)

call "%~dp0_medyaatlas_paths.bat"
call "%~dp0_flutter_env.bat"

echo.
echo === MedyaAtlas Windows zip ===
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

echo [1/2] pub get...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 (
  echo HATA: pub get
  goto :end
)

echo [2/2] flutter build windows --release...
"%ComSpec%" /c call "%FLUTTER%" build windows --release
if errorlevel 1 (
  echo HATA: Windows derlenemedi. Visual Studio C++ workload gerekebilir.
  goto :end
)

set "SRC=build\windows\x64\runner\Release"
if not exist "%SRC%\medyaatlas.exe" if not exist "%SRC%\MedyaAtlas.exe" (
  echo HATA: Release klasoru yok: %SRC%
  dir /b "build\windows\x64\runner" 2>nul
  goto :end
)

if not exist "dist" mkdir "dist"
set "OUT=dist\MedyaAtlas-windows.zip"
if exist "%OUT%" del /f /q "%OUT%"
powershell -NoProfile -Command "Compress-Archive -Path '%SRC%\*' -DestinationPath '%OUT%' -Force"
if errorlevel 1 (
  echo HATA: zip olusturulamadi.
  goto :end
)

echo.
echo Windows zip hazir (sabit ad):
echo   %CD%\%OUT%
echo.
echo Indirme linki:
echo   https://github.com/alid67-git/MedyaAtlas/releases/download/windows-latest/MedyaAtlas-windows.zip
echo.
explorer "dist"

:end
pause
