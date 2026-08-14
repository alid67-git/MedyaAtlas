@echo off
REM Ortak Flutter ortamı. run_windows.bat / run_android.bat bunu call eder.

if exist "C:\Program Files\Git\cmd\git.exe" set "PATH=C:\Program Files\Git\cmd;%PATH%"
if exist "C:\Program Files\Git\bin\git.exe" set "PATH=C:\Program Files\Git\bin;%PATH%"

REM D: takili olmayinca `if exist D:\...` cmd'de takilabiliyor / false donuyor.
REM Once C: (kalici), sonra eski D: yolu, sonra PATH.
set "FLUTTER_ROOT="
set "FLUTTER="

if exist "C:\src\flutter\bin\flutter.bat" (
  set "FLUTTER_ROOT=C:\src\flutter"
  goto :flutter_found
)
if exist "D:\indirilenler\flutter_windows_3.44.8-stable\flutter\bin\flutter.bat" (
  set "FLUTTER_ROOT=D:\indirilenler\flutter_windows_3.44.8-stable\flutter"
  goto :flutter_found
)

for /f "delims=" %%I in ('where flutter 2^>nul') do (
  set "FLUTTER=%%I"
  goto :flutter_from_path
)

goto :flutter_done

:flutter_from_path
for %%I in ("%FLUTTER%") do set "FLUTTER_ROOT=%%~dpI.."
for %%I in ("%FLUTTER_ROOT%") do set "FLUTTER_ROOT=%%~fI"
goto :flutter_meta

:flutter_found
set "FLUTTER=%FLUTTER_ROOT%\bin\flutter.bat"

:flutter_meta
set "GIT_CONFIG_COUNT=1"
set "GIT_CONFIG_KEY_0=safe.directory"
set "GIT_CONFIG_VALUE_0=%FLUTTER_ROOT:\=/%"

if exist "%FLUTTER_ROOT%\bin\internal\engine.version" (
  set /p FLUTTER_PREBUILT_ENGINE_VERSION=<"%FLUTTER_ROOT%\bin\internal\engine.version"
)

:flutter_done
REM Google Drive bazen ios\Flutter\ephemeral kilitleyip pub get'i 1 ile bitirir.
if exist "%~dp0ios\Flutter\ephemeral" rmdir /s /q "%~dp0ios\Flutter\ephemeral" 2>nul
