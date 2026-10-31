@echo off
setlocal EnableDelayedExpansion
title CatRealm Client
cd /d "%~dp0"

set "LOCKFILE=package-lock.json"
set "PKGFILE=package.json"
set "HASHFILE=.deps-lock.hash"
set "NEEDS_INSTALL=0"
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist node_modules (
    set "NEEDS_INSTALL=1"
)

if not exist "%HASHFILE%" (
    set "NEEDS_INSTALL=1"
)

if exist "%LOCKFILE%" (
    for /f "tokens=1 delims= " %%H in ('certutil -hashfile "%LOCKFILE%" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"') do (
        set "LOCKHASH=%%H"
        goto :got_lock_hash
    )
) else (
    for /f "tokens=1 delims= " %%H in ('certutil -hashfile "%PKGFILE%" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"') do (
        set "LOCKHASH=%%H"
        goto :got_lock_hash
    )
)

:got_lock_hash
if exist "%HASHFILE%" (
    set /p SAVEDHASH=<"%HASHFILE%"
    if /i not "!SAVEDHASH!"=="!LOCKHASH!" (
        set "NEEDS_INSTALL=1"
    )
)

if "!NEEDS_INSTALL!"=="1" (
    echo Installing/updating dependencies...
    call npm.cmd install
    if errorlevel 1 (
        echo Dependency install failed.
        pause
        exit /b 1
    )
    > "%HASHFILE%" echo !LOCKHASH!
    echo.
)

echo Starting CatRealm...
set "LAUNCH_MODE=%~1"
if /i "%LAUNCH_MODE%"=="--debug" set "LAUNCH_MODE=debug"
if /i "%LAUNCH_MODE%"=="--profile" set "LAUNCH_MODE=profile"
if not defined LAUNCH_MODE set "LAUNCH_MODE=lean"

rem Start clean even when these variables exist in the parent shell. The lean
rem mode is intended for representative memory/performance comparisons.
set "CATREALM_CHROMIUM_LOG="
set "CATREALM_CAPTURE_TEST_DEBUG="
set "CATREALM_NATIVE_WHIP_DEBUG="
set "ELECTRON_ENABLE_LOGGING="
set "ELECTRON_ENABLE_STACK_DUMPING="
set "ELECTRON_REMOTE_DEBUG="
set "CATREALM_DEBUG_LOG_DIR="

if /i "%LAUNCH_MODE%"=="debug" goto :enable_debug
if /i "%LAUNCH_MODE%"=="profile" goto :enable_profile
if /i not "%LAUNCH_MODE%"=="lean" (
    echo Unknown mode "%LAUNCH_MODE%".
    echo Usage: manual-start-dev.bat [lean^|profile^|debug]
    exit /b 2
)

:enable_lean
rem Keep a localhost-only DevTools endpoint available for live diagnosis without
rem enabling Chromium's verbose logging or opening a DevTools window.
set "ELECTRON_REMOTE_DEBUG=9222"
echo Launch mode: lean ^(debug logging disabled; local inspector on 127.0.0.1:9222^)
if exist "%ELECTRON_EXE%" (
    rem Older versions of this launcher persisted a high-performance GPU rule.
    rem Remove that dev-only override so Windows can choose the normal adapter.
    reg delete "HKCU\Software\Microsoft\DirectX\UserGpuPreferences" /v "%ELECTRON_EXE%" /f >nul 2>nul
)
goto :launch

:enable_profile
set "ELECTRON_REMOTE_DEBUG=9222"
echo Launch mode: profile ^(DevTools protocol on 127.0.0.1:9222^)
if exist "%ELECTRON_EXE%" (
    reg delete "HKCU\Software\Microsoft\DirectX\UserGpuPreferences" /v "%ELECTRON_EXE%" /f >nul 2>nul
)
goto :launch

:enable_debug
set "CATREALM_CHROMIUM_LOG=1"
set "CATREALM_CAPTURE_TEST_DEBUG=1"
set "CATREALM_NATIVE_WHIP_DEBUG=1"
set "ELECTRON_ENABLE_LOGGING=1"
set "ELECTRON_ENABLE_STACK_DUMPING=1"
set "ELECTRON_REMOTE_DEBUG=9222"
set "CATREALM_DEBUG_LOG_DIR=%APPDATA%\CatRealm\logs"
if not exist "%CATREALM_DEBUG_LOG_DIR%" mkdir "%CATREALM_DEBUG_LOG_DIR%" >nul 2>nul
> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo manual-start-dev launched at %DATE% %TIME%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo cwd=%CD%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo launchMode=%LAUNCH_MODE%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo CATREALM_CHROMIUM_LOG=%CATREALM_CHROMIUM_LOG%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo CATREALM_CAPTURE_TEST_DEBUG=%CATREALM_CAPTURE_TEST_DEBUG%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo CATREALM_NATIVE_WHIP_DEBUG=%CATREALM_NATIVE_WHIP_DEBUG%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo ELECTRON_ENABLE_LOGGING=%ELECTRON_ENABLE_LOGGING%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo ELECTRON_ENABLE_STACK_DUMPING=%ELECTRON_ENABLE_STACK_DUMPING%
>> "%CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log" echo CATREALM_DEBUG_LOG_DIR=%CATREALM_DEBUG_LOG_DIR%
>> "%CATREALM_DEBUG_LOG_DIR%\client-debug.log" echo {"at":"%DATE% %TIME%","level":"info","scope":"manual-start-dev","message":"launcher started","details":{"cwd":"%CD%"}}
echo Launch mode: debug
echo   Chromium GPU/capture log: %CATREALM_DEBUG_LOG_DIR%\chromium.log
echo   Client capture breadcrumbs: %CATREALM_DEBUG_LOG_DIR%\client-debug.log
echo   Native WHIP/GStreamer diagnostics: %CATREALM_DEBUG_LOG_DIR%\client-debug.log
echo   Launcher marker: %CATREALM_DEBUG_LOG_DIR%\manual-start-dev-debug.log
if exist "%ELECTRON_EXE%" (
    reg add "HKCU\Software\Microsoft\DirectX\UserGpuPreferences" /v "%ELECTRON_EXE%" /t REG_SZ /d "GpuPreference=2;" /f >nul 2>nul
    echo   Windows GPU preference: High performance
)
goto :launch

:launch
echo.
echo Other modes: manual-start-dev.bat profile ^| debug
echo.
call npm.cmd run dev:electron
pause
