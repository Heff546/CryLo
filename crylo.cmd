@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Ordinary CryLo Windows users enter through CMD only.
rem The first-run bootstrap uses trusted Windows curl/tar/certutil, then
rem an authenticated Node.js helper. No PowerShell, system Node, or system Git.
cd /d "%~dp0"
if errorlevel 1 (
    echo ERROR: Unable to enter the CryLo installation directory.
    exit /b 1
)

if /I not "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    if /I not "%PROCESSOR_ARCHITEW6432%"=="AMD64" (
        echo ERROR: CryLo currently supports Windows x64 only.
        exit /b 1
    )
)

if not defined LOCALAPPDATA (
    echo ERROR: LOCALAPPDATA is not configured.
    exit /b 1
)
set "CRYLO_WINDOWS_ROOT=%SystemRoot%"
if not defined CRYLO_WINDOWS_ROOT set "CRYLO_WINDOWS_ROOT=%WINDIR%"
if not defined CRYLO_WINDOWS_ROOT (
    echo ERROR: Windows system directory is unavailable.
    exit /b 1
)

set "CRYLO_CURL=%CRYLO_WINDOWS_ROOT%\System32\curl.exe"
set "CRYLO_TAR=%CRYLO_WINDOWS_ROOT%\System32\tar.exe"
set "CRYLO_CERTUTIL=%CRYLO_WINDOWS_ROOT%\System32\certutil.exe"
if not exist "%CRYLO_CURL%" goto required_windows_tool_missing
if not exist "%CRYLO_TAR%" goto required_windows_tool_missing
if not exist "%CRYLO_CERTUTIL%" goto required_windows_tool_missing

set "CRYLO_NODE_VERSION=24.21.0"
set "CRYLO_NODE_NAME=node-v%CRYLO_NODE_VERSION%-win-x64"
set "CRYLO_NODE_SHA256=158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"
set "CRYLO_NODE_EXE_SHA256=ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32"
set "CRYLO_NPM_VERSION=12.1.0"
set "CRYLO_GIT_VERSION=2.56.0"
set "CRYLO_GIT_BUILD=2.56.0.windows.1"
set "CRYLO_GIT_SHA256=064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718"
set "CRYLO_RUNTIME_ROOT=%LOCALAPPDATA%\CryLo\runtime"
set "CRYLO_NODE_DIRECTORY=%CRYLO_RUNTIME_ROOT%\%CRYLO_NODE_NAME%"
set "CRYLO_NODE_EXE=%CRYLO_NODE_DIRECTORY%\node.exe"
set "CRYLO_NODE_BACKUP=%CRYLO_NODE_DIRECTORY%.pre-crylo-bootstrap"
set "CRYLO_GIT_DIRECTORY=%CRYLO_RUNTIME_ROOT%\mingit-%CRYLO_GIT_BUILD%-x64"
set "CRYLO_GIT_BACKUP=%CRYLO_GIT_DIRECTORY%.pre-crylo-bootstrap"
set "CRYLO_GIT_EXE=%CRYLO_GIT_DIRECTORY%\cmd\git.exe"
set "CRYLO_NODE_URL=https://nodejs.org/dist/v%CRYLO_NODE_VERSION%/%CRYLO_NODE_NAME%.zip"
set "CRYLO_HELPER=%~dp0scripts\windows-runtime-bootstrap.js"

if not exist "%CRYLO_HELPER%" (
    echo ERROR: CryLo authenticated Windows runtime helper is missing.
    exit /b 1
)
if not exist "%CRYLO_RUNTIME_ROOT%" mkdir "%CRYLO_RUNTIME_ROOT%" >nul 2>nul
if not exist "%CRYLO_RUNTIME_ROOT%" (
    echo ERROR: Unable to create CryLo managed runtime directory.
    exit /b 1
)
if exist "%CRYLO_NODE_BACKUP%" goto recovery_backup_present
if exist "%CRYLO_GIT_BACKUP%" goto recovery_backup_present
if exist "%CRYLO_NODE_DIRECTORY%.pre-crylo-install" goto recovery_backup_present
if exist "%CRYLO_GIT_DIRECTORY%.pre-crylo-install" goto recovery_backup_present

rem Never execute an unverified or user-substituted Node.js binary.
if not exist "%CRYLO_NODE_EXE%" goto bootstrap
call :verify_sha256 "%CRYLO_NODE_EXE%" "%CRYLO_NODE_EXE_SHA256%"
if errorlevel 1 goto bootstrap
"%CRYLO_NODE_EXE%" "%CRYLO_HELPER%" verify >nul 2>nul
if not errorlevel 1 goto ready

:bootstrap
echo Preparing authenticated CryLo Node.js, npm, and MinGit for Windows x64...
set "CRYLO_STAGE=%CRYLO_RUNTIME_ROOT%\.crylo-bootstrap-%RANDOM%-%RANDOM%"
if exist "%CRYLO_STAGE%" (
    echo ERROR: The CryLo bootstrap staging path already exists.
    exit /b 1
)
mkdir "%CRYLO_STAGE%" >nul 2>nul
if errorlevel 1 (
    echo ERROR: Could not create the private CryLo bootstrap staging directory.
    exit /b 1
)
set "CRYLO_NODE_ARCHIVE=%CRYLO_STAGE%\%CRYLO_NODE_NAME%.zip"
set "CRYLO_STAGED_NODE=%CRYLO_STAGE%\%CRYLO_NODE_NAME%\node.exe"

"%CRYLO_CURL%" --fail --location --silent --show-error --proto "=https" --proto-redir "=https" --max-redirs 5 --tlsv1.2 --connect-timeout 15 --max-time 180 --output "%CRYLO_NODE_ARCHIVE%" "%CRYLO_NODE_URL%"
if errorlevel 1 goto bootstrap_failed

call :verify_sha256 "%CRYLO_NODE_ARCHIVE%" "%CRYLO_NODE_SHA256%"
if errorlevel 1 goto bootstrap_failed
"%CRYLO_TAR%" -xf "%CRYLO_NODE_ARCHIVE%" -C "%CRYLO_STAGE%"
if errorlevel 1 goto bootstrap_failed
if not exist "%CRYLO_STAGED_NODE%" goto bootstrap_failed
call :verify_sha256 "%CRYLO_STAGED_NODE%" "%CRYLO_NODE_EXE_SHA256%"
if errorlevel 1 goto bootstrap_failed

"%CRYLO_STAGED_NODE%" "%CRYLO_HELPER%" activate "%CRYLO_STAGE%"
if errorlevel 1 goto bootstrap_failed

rem The staged executable exits before its temporary directory is deleted.
rmdir /s /q "%CRYLO_STAGE%" >nul 2>nul
if not exist "%CRYLO_NODE_EXE%" goto bootstrap_failed
call :verify_sha256 "%CRYLO_NODE_EXE%" "%CRYLO_NODE_EXE_SHA256%"
if errorlevel 1 goto bootstrap_failed
"%CRYLO_NODE_EXE%" "%CRYLO_HELPER%" verify
if errorlevel 1 goto bootstrap_failed
goto ready

:ready
set "CRYLO_NODE_RUNTIME=%CRYLO_NODE_DIRECTORY%"
set "CRYLO_GIT_RUNTIME=%CRYLO_GIT_DIRECTORY%"
set "GIT_TERMINAL_PROMPT=0"
set "PATH=%CRYLO_NODE_DIRECTORY%;%CRYLO_GIT_DIRECTORY%\cmd;%PATH%"
"%CRYLO_NODE_EXE%" "%~dp0scripts\crylo.js" %*
exit /b %ERRORLEVEL%

:verify_sha256
if not exist "%~1" exit /b 1
set "CRYLO_HASH_FILE=%TEMP%\crylo-sha-%RANDOM%-%RANDOM%.txt"
"%CRYLO_CERTUTIL%" -hashfile "%~1" SHA256 > "%CRYLO_HASH_FILE%" 2>nul
if errorlevel 1 (
    del /q "%CRYLO_HASH_FILE%" >nul 2>nul
    exit /b 1
)
rem Exact-line case-insensitive match, never a substring.
"%CRYLO_WINDOWS_ROOT%\System32\findstr.exe" /L /I /X /C:"%~2" "%CRYLO_HASH_FILE%" >nul 2>nul
set "CRYLO_HASH_RC=%ERRORLEVEL%"
del /q "%CRYLO_HASH_FILE%" >nul 2>nul
exit /b %CRYLO_HASH_RC%

:required_windows_tool_missing
echo ERROR: Windows curl.exe, tar.exe, and certutil.exe are required.
echo CryLo will not invoke PowerShell or an unverified fallback.
exit /b 1

:recovery_backup_present
echo ERROR: An earlier CryLo Windows runtime recovery backup exists.
echo Existing wallet data and runtime backups have been preserved.
echo Resolve the recovery state before repeating CryLo installation.
exit /b 1

:bootstrap_failed
echo ERROR: CryLo Windows runtime provisioning failed.
echo The existing managed runtimes and user wallet/configuration were not intentionally modified.
echo Check the preserved staging and recovery state before retrying.
echo Staging: %CRYLO_STAGE%
exit /b 1
