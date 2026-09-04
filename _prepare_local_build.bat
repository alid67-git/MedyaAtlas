@echo off
REM Yerel derleme klasorleri + eski Google Drive CMake onbellegini temizle.

if not exist "C:\src" mkdir "C:\src"

set "PROJ_ROOT=%~dp0"
if "%PROJ_ROOT:~-1%"=="\" set "PROJ_ROOT=%PROJ_ROOT:~0,-1%"

REM C:\src\MedyaAtlas icindeyiz: junction sart degil, build proje altinda kalsin.
echo %PROJ_ROOT%| find /i "C:\src\MedyaAtlas" >nul
if not errorlevel 1 (
  call :scrub_cmake "%PROJ_ROOT%\build"
  goto :flutter_build_local
)

REM Drive / baska kopya: build'i C:\src altina junction et (yeni temiz klasor adi).
set "LOCAL_BUILD=C:\src\medyaatlas_build_local"
if not exist "%LOCAL_BUILD%" mkdir "%LOCAL_BUILD%"
set "PROJ_BUILD=%~dp0build"
fsutil reparsepoint query "%PROJ_BUILD%" >nul 2>&1
if not errorlevel 1 (
  call :scrub_cmake "%LOCAL_BUILD%"
  goto :flutter_build_local
)
if exist "%PROJ_BUILD%" rmdir /s /q "%PROJ_BUILD%" 2>nul
if exist "%PROJ_BUILD%" move /y "%PROJ_BUILD%" "%PROJ_BUILD%.gdrive.bak" >nul 2>&1
if exist "%PROJ_BUILD%" (
  echo UYARI: build klasoru kilitli, yerel diske alinamadi.
  goto :flutter_build_local
)
mklink /J "%PROJ_BUILD%" "%LOCAL_BUILD%" >nul
if not errorlevel 1 echo Derleme klasoru: %LOCAL_BUILD%
call :scrub_cmake "%LOCAL_BUILD%"

:flutter_build_local
set "LOCAL_FB=C:\src\medyaatlas_flutter_build_local"
if not exist "%LOCAL_FB%" mkdir "%LOCAL_FB%"
if not exist "%~dp0.dart_tool" mkdir "%~dp0.dart_tool"
set "PROJ_FB=%~dp0.dart_tool\flutter_build"
fsutil reparsepoint query "%PROJ_FB%" >nul 2>&1
if not errorlevel 1 goto :ephemeral
if exist "%PROJ_FB%" rmdir /s /q "%PROJ_FB%" 2>nul
if exist "%PROJ_FB%" move /y "%PROJ_FB%" "%PROJ_FB%.gdrive.bak" >nul 2>&1
if exist "%PROJ_FB%" goto :ephemeral
mklink /J "%PROJ_FB%" "%LOCAL_FB%" >nul

:ephemeral
set "LOCAL_EPH=C:\src\medyaatlas_ephemeral_local"
if not exist "%LOCAL_EPH%" mkdir "%LOCAL_EPH%"
if not exist "%~dp0windows\flutter" mkdir "%~dp0windows\flutter"
set "PROJ_EPH=%~dp0windows\flutter\ephemeral"
fsutil reparsepoint query "%PROJ_EPH%" >nul 2>&1
if not errorlevel 1 goto :eof
if exist "%PROJ_EPH%\.plugin_symlinks" rmdir /s /q "%PROJ_EPH%\.plugin_symlinks" 2>nul
if exist "%PROJ_EPH%" rmdir /s /q "%PROJ_EPH%" 2>nul
if exist "%PROJ_EPH%" move /y "%PROJ_EPH%" "%PROJ_EPH%.gdrive.bak" >nul 2>&1
if exist "%PROJ_EPH%" goto :eof
mklink /J "%PROJ_EPH%" "%LOCAL_EPH%" >nul
if not errorlevel 1 echo Ephemeral: %LOCAL_EPH%
goto :eof

:scrub_cmake
set "ROOT=%~1"
if "%ROOT%"=="" goto :eof
set "CACHE=%ROOT%\windows\CMakeCache.txt"
if not exist "%CACHE%" goto :eof
findstr /i /c:"google drive" "%CACHE%" >nul 2>&1
if not errorlevel 1 goto :do_scrub
findstr /i /c:"MediaAtlasApp" "%CACHE%" >nul 2>&1
if not errorlevel 1 goto :do_scrub
REM Cache baska kaynaktan uretilmisse (yol uyusmazligi) sil.
findstr /i /c:"C:/src/MedyaAtlas" "%CACHE%" >nul 2>&1
if errorlevel 1 (
  echo %PROJ_ROOT%| find /i "C:\src\MedyaAtlas" >nul
  if not errorlevel 1 goto :do_scrub
)
goto :eof

:do_scrub
echo Eski Windows CMake onbellegi temizleniyor...
rmdir /s /q "%ROOT%\windows" 2>nul
REM Eski paylasilan Drive build artiklari
rmdir /s /q "C:\src\medyaatlas_app_build\windows" 2>nul
goto :eof
