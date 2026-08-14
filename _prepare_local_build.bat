@echo off
REM Google Drive build/flutter_assets kilidi: ciktiyi C:\src altina al.
set "LOCAL_BUILD=C:\src\medyaatlas_app_build"
if not exist "C:\src" mkdir "C:\src"
if not exist "%LOCAL_BUILD%" mkdir "%LOCAL_BUILD%"

set "PROJ_BUILD=%~dp0build"
fsutil reparsepoint query "%PROJ_BUILD%" >nul 2>&1
if not errorlevel 1 goto :flutter_build

if exist "%PROJ_BUILD%" rmdir /s /q "%PROJ_BUILD%" 2>nul
if exist "%PROJ_BUILD%" move /y "%PROJ_BUILD%" "%PROJ_BUILD%.gdrive.bak" >nul 2>&1
if exist "%PROJ_BUILD%" (
  echo UYARI: build klasoru Google Drive'da kilitli, yerel diske alinamadi.
  goto :flutter_build
)
mklink /J "%PROJ_BUILD%" "%LOCAL_BUILD%" >nul
if not errorlevel 1 echo Derleme klasoru: %LOCAL_BUILD%

:flutter_build
set "LOCAL_FB=C:\src\medyaatlas_app_flutter_build"
if not exist "%LOCAL_FB%" mkdir "%LOCAL_FB%"
if not exist "%~dp0.dart_tool" mkdir "%~dp0.dart_tool"
set "PROJ_FB=%~dp0.dart_tool\flutter_build"
fsutil reparsepoint query "%PROJ_FB%" >nul 2>&1
if not errorlevel 1 goto :eof
if exist "%PROJ_FB%" rmdir /s /q "%PROJ_FB%" 2>nul
if exist "%PROJ_FB%" move /y "%PROJ_FB%" "%PROJ_FB%.gdrive.bak" >nul 2>&1
if exist "%PROJ_FB%" goto :eof
mklink /J "%PROJ_FB%" "%LOCAL_FB%" >nul
