@echo off
setlocal EnableDelayedExpansion
title CatRealm Tauri Client
cd /d "%~dp0"

set "TAURI_DIR=%~dp0"
for %%I in ("%TAURI_DIR%..") do set "REPO_DIR=%%~fI"
set "RENDERER_DIR=%REPO_DIR%\CatRealm-Client"
set "CATREALM_DEBUG_LOG_DIR=%APPDATA%\CatRealm\logs"

if not exist "%RENDERER_DIR%\package.json" (
    echo Could not find CatRealm-Client at:
    echo   %RENDERER_DIR%
    pause
    exit /b 1
)

if not exist "%CATREALM_DEBUG_LOG_DIR%" mkdir "%CATREALM_DEBUG_LOG_DIR%" >nul 2>nul
> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo manual-start-dev launched at %DATE% %TIME%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo tauri_dir=%TAURI_DIR%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo renderer_dir=%RENDERER_DIR%

call :ensure_deps "%RENDERER_DIR%" "React renderer"
if errorlevel 1 (
    pause
    exit /b 1
)

call :ensure_deps "%TAURI_DIR%" "Tauri Rust shell"
if errorlevel 1 (
    pause
    exit /b 1
)

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 (
    echo Rust/Cargo is not installed or is not on PATH.
    echo Install Rust from https://rustup.rs/ and reopen this launcher.
    pause
    exit /b 1
)

pushd "%TAURI_DIR%" >nul
call npm.cmd run prepare:native
set "PREPARE_NATIVE_EXIT=%ERRORLEVEL%"
popd >nul
if not "%PREPARE_NATIVE_EXIT%"=="0" (
    pause
    exit /b 1
)

if "%CATREALM_TAURI_LAUNCHER_SELF_TEST%"=="1" (
    echo Launcher self-test passed.
    exit /b 0
)

set "CATREALM_CHROMIUM_LOG=1"
set "CATREALM_CAPTURE_TEST_DEBUG=1"
set "CATREALM_NATIVE_WHIP_DEBUG=1"
set "RUST_BACKTRACE=1"
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo CATREALM_CHROMIUM_LOG=%CATREALM_CHROMIUM_LOG%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo CATREALM_CAPTURE_TEST_DEBUG=%CATREALM_CAPTURE_TEST_DEBUG%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo CATREALM_NATIVE_WHIP_DEBUG=%CATREALM_NATIVE_WHIP_DEBUG%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log" echo RUST_BACKTRACE=%RUST_BACKTRACE%
>> "%CATREALM_DEBUG_LOG_DIR%\client-debug.log" echo {"at":"%DATE% %TIME%","level":"info","scope":"manual-start-tauri-dev","message":"launcher started","details":{"cwd":"%CD%"}}

echo Debug logging enabled:
echo   Client capture breadcrumbs: %CATREALM_DEBUG_LOG_DIR%\client-debug.log
echo   Tauri launcher marker: %CATREALM_DEBUG_LOG_DIR%\manual-start-tauri-dev-debug.log
echo.

echo Starting CatRealm Vite + Tauri dev shell...
call "%RENDERER_DIR%\node_modules\.bin\concurrently.cmd" -k -n vite,tauri -c cyan,green "npm.cmd --prefix ""%RENDERER_DIR%"" run dev" "call ""%RENDERER_DIR%\node_modules\.bin\wait-on.cmd"" http://localhost:5173 --timeout 60000 && cd /d ""%TAURI_DIR%src-tauri"" && cargo run"
pause
exit /b %ERRORLEVEL%

:ensure_deps
set "APP_DIR=%~1"
set "APP_LABEL=%~2"
set "LOCKFILE=%APP_DIR%\package-lock.json"
set "PKGFILE=%APP_DIR%\package.json"
set "HASHFILE=%APP_DIR%\.deps-lock.hash"
set "NEEDS_INSTALL=0"
set "LOCKHASH="

if not exist "%APP_DIR%\node_modules" (
    set "NEEDS_INSTALL=1"
)

if not exist "%HASHFILE%" (
    set "NEEDS_INSTALL=1"
)

if exist "%LOCKFILE%" (
    for /f "tokens=1 delims= " %%H in ('certutil -hashfile "%LOCKFILE%" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"') do (
        set "LOCKHASH=%%H"
        goto :got_dep_hash
    )
) else (
    for /f "tokens=1 delims= " %%H in ('certutil -hashfile "%PKGFILE%" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"') do (
        set "LOCKHASH=%%H"
        goto :got_dep_hash
    )
)

:got_dep_hash
if exist "%HASHFILE%" (
    set /p SAVEDHASH=<"%HASHFILE%"
    if /i not "!SAVEDHASH!"=="!LOCKHASH!" (
        set "NEEDS_INSTALL=1"
    )
)

if "%NEEDS_INSTALL%"=="1" (
    echo Installing/updating %APP_LABEL% dependencies...
    pushd "%APP_DIR%" >nul
    call npm.cmd install
    if errorlevel 1 (
        popd >nul
        echo %APP_LABEL% dependency install failed.
        exit /b 1
    )
    popd >nul
    > "%HASHFILE%" echo !LOCKHASH!
    echo.
)

exit /b 0
