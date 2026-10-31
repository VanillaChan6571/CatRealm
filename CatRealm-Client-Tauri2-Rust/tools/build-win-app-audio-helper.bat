@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_DIR=%%~fI"
set "HELPER_DIR=%REPO_DIR%\CatRealm-Client\electron\native\win-app-audio"
set "HELPER_SRC=%HELPER_DIR%\CatRealmAppAudioCapture.cpp"
set "HELPER_BIN=%HELPER_DIR%\bin\CatRealmAppAudioCapture.exe"

if exist "%HELPER_BIN%" (
    echo App-audio helper already exists:
    echo   %HELPER_BIN%
    exit /b 0
)

if not exist "%HELPER_SRC%" (
    echo Could not find app-audio helper source:
    echo   %HELPER_SRC%
    exit /b 1
)

set "VCVARS="
if exist "%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if not defined VCVARS (
    echo Could not find Visual Studio 2022 C++ build tools.
    echo Install "Desktop development with C++" or commit CatRealmAppAudioCapture.exe into the repo.
    exit /b 1
)

if not exist "%HELPER_DIR%\bin" mkdir "%HELPER_DIR%\bin" >nul 2>nul

echo Building app-audio helper with MSVC...
pushd "%HELPER_DIR%" >nul
call "%VCVARS%" >nul
cl /nologo /std:c++17 /EHsc /O2 /MT /DWIN32_LEAN_AND_MEAN /DNOMINMAX /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 /DWINVER=0x0A00 /DNTDDI_VERSION=0x0A00000C /Fo:bin\CatRealmAppAudioCapture.obj CatRealmAppAudioCapture.cpp /link /OUT:bin\CatRealmAppAudioCapture.exe ole32.lib oleaut32.lib avrt.lib mmdevapi.lib user32.lib uuid.lib
set "BUILD_EXIT=%ERRORLEVEL%"
popd >nul

if not "%BUILD_EXIT%"=="0" (
    echo App-audio helper build failed.
    exit /b %BUILD_EXIT%
)

echo Built:
echo   %HELPER_BIN%
exit /b 0
