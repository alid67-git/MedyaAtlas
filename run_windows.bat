@echo off
setlocal EnableExtensions
title MedyaAtlas Windows

REM Ilk cift tik: ayri pencere.
if /i not "%~1"=="_go" (
  start "MedyaAtlas Windows" cmd /k call "%~f0" _go
  exit /b 0
)

call "%~dp0_medyaatlas_paths.bat"
call "%~dp0_flutter_env.bat"

echo.
echo === MedyaAtlas Windows ===
echo Hedef surum: v%MA_EXPECT%
echo Yerel repo:  %MA_LOCAL%
echo.

REM Google Drive'dan acildiysa uyar.
echo %~dp0| find /i "google drive" >nul
if not errorlevel 1 (
  echo UYARI: Bu bat Google Drive kopyasindan acildi.
  echo         Asil calisma: %MA_LOCAL%
  echo         Bir kez tasi_c_src.bat calistirman yeterli.
  echo.
)

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git yok.
  goto :end
)

set "MA_REMOTE="
for /f "delims=" %%U in ('git -C "%~dp0" remote get-url origin 2^>nul') do set "MA_REMOTE=%%U"
if not defined MA_REMOTE set "MA_REMOTE=%MA_REMOTE_DEFAULT%"

if not exist "C:\src" mkdir "C:\src"

echo --- %MA_LOCAL% guncelle ---
if not exist "%MA_LOCAL%\.git" (
  echo Ilk kurulum: clone %MA_BRANCH% ...
  if exist "%MA_LOCAL%" rmdir /s /q "%MA_LOCAL%" 2>nul
  git clone --branch "%MA_BRANCH%" --single-branch "%MA_REMOTE%" "%MA_LOCAL%"
  if errorlevel 1 (
    echo HATA: clone basarisiz. Once tasi_c_src.bat dene.
    goto :end
  )
  call "%MA_LOCAL%\kisayol_olustur.bat" _silent
) else (
  git -C "%MA_LOCAL%" remote set-url origin "%MA_REMOTE%" 2>nul
  git -C "%MA_LOCAL%" fetch origin "%MA_BRANCH%"
  if errorlevel 1 (
    echo HATA: fetch basarisiz.
    goto :end
  )
  git -C "%MA_LOCAL%" checkout -B "%MA_BRANCH%" "origin/%MA_BRANCH%"
  git -C "%MA_LOCAL%" reset --hard "origin/%MA_BRANCH%"
  if errorlevel 1 (
    echo HATA: reset basarisiz.
    goto :end
  )
)

echo.
git -C "%MA_LOCAL%" log -1 --oneline
echo.

set "MA_VER="
if exist "%MA_LOCAL%\lib\app_version.dart" (
  type "%MA_LOCAL%\lib\app_version.dart"
  echo.
  for /f "tokens=2 delims='" %%A in ('findstr /C:"appVersion" "%MA_LOCAL%\lib\app_version.dart"') do set "MA_VER=%%A"
)

if /i not "%MA_VER%"=="%MA_EXPECT%" (
  echo HATA: Beklenen v%MA_EXPECT%, bulunan v%MA_VER%
  goto :end
)

echo Surum dogrulandi: v%MA_VER%
cd /d "%MA_LOCAL%"

if not exist "%FLUTTER%" (
  echo HATA: Flutter bulunamadi.
  goto :end
)

echo Flutter: %FLUTTER%
echo.

call "%MA_LOCAL%\_prepare_local_build.bat"

echo [1/2] pub get...
"%ComSpec%" /c call "%FLUTTER%" pub get
if errorlevel 1 echo UYARI: pub get hata verdi; run denenecek.

echo [2/2] Windows uygulamasi ^(v%MA_VER%^)...
echo Impeller kapali. Cikis: q
echo.
"%ComSpec%" /c call "%FLUTTER%" run -d windows --no-enable-impeller
if errorlevel 1 (
  echo HATA: Gelistirici Modu ^(symlink^) gerekebilir.
  start ms-settings:developers
)

:end
echo.
pause
