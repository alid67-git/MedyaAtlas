@echo off
setlocal EnableExtensions
title MediaAtlas kisayol
cd /d "%~dp0"

call "%~dp0_medyaatlas_paths.bat"

set "SILENT=0"
if /i "%~1"=="_silent" set "SILENT=1"

set "TARGET=%MA_LOCAL%\run_windows.bat"
set "WORKDIR=%MA_LOCAL%"
if not exist "%TARGET%" (
  set "TARGET=%~dp0run_windows.bat"
  set "WORKDIR=%~dp0"
)
if not "%WORKDIR:~-1%"=="\" set "WORKDIR=%WORKDIR%\"

set "ICON=%SystemRoot%\System32\shell32.dll,13"
if exist "%WORKDIR%windows\runner\resources\app_icon.ico" (
  set "ICON=%WORKDIR%windows\runner\resources\app_icon.ico"
)

set "MA_SC_TARGET=%TARGET%"
set "MA_SC_WORKDIR=%WORKDIR%"
set "MA_SC_ICON=%ICON%"

echo.
echo Hedef: %TARGET%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$t=$env:MA_SC_TARGET; $w=$env:MA_SC_WORKDIR; $i=$env:MA_SC_ICON;" ^
  "if ([string]::IsNullOrWhiteSpace($t)) { throw 'MA_SC_TARGET bos' };" ^
  "$ws=New-Object -ComObject WScript.Shell;" ^
  "$desk=[Environment]::GetFolderPath('Desktop');" ^
  "$programs=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs';" ^
  "if (-not (Test-Path $programs)) { New-Item -ItemType Directory -Force -Path $programs | Out-Null };" ^
  "foreach ($p in @((Join-Path $desk 'MediaAtlas Windows.lnk'), (Join-Path $programs 'MediaAtlas Windows.lnk'), (Join-Path $desk 'MedyaAtlas Windows.lnk'), (Join-Path $programs 'MedyaAtlas Windows.lnk'))) {" ^
  "  $s=$ws.CreateShortcut($p); $s.TargetPath=$t; $s.WorkingDirectory=$w; $s.WindowStyle=1;" ^
  "  $s.Description='MediaAtlas (C:\\src\\MedyaAtlas)'; $s.IconLocation=$i; $s.Save(); Write-Host ('OK ' + $p);" ^
  "}"

if errorlevel 1 (
  echo HATA: kisayol olusturulamadi.
  if "%SILENT%"=="0" pause
  exit /b 1
)

echo.
echo Masaustu + Baslat: MediaAtlas Windows
if "%SILENT%"=="0" (
  echo.
  pause
)
exit /b 0
