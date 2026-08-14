@echo off
setlocal EnableExtensions
title MedyaAtlas build temizle
cd /d "%~dp0"

call "%~dp0_medyaatlas_paths.bat" 2>nul

echo.
echo === Windows derleme onbellegi temizleniyor ===
echo.

rmdir /s /q "%~dp0build\windows" 2>nul
rmdir /s /q "%MA_LOCAL%\build\windows" 2>nul
rmdir /s /q "C:\src\medyaatlas_app_build\windows" 2>nul
rmdir /s /q "C:\src\medyaatlas_app_build" 2>nul
rmdir /s /q "C:\src\medyaatlas_build_local\windows" 2>nul
rmdir /s /q "C:\src\medyaatlas_windows_ephemeral" 2>nul

echo Tamam. Simdi C:\src\MedyaAtlas\run_windows.bat calistir.
echo.
pause
