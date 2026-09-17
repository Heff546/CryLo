@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if /I not "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    if /I not "%PROCESSOR_ARCHITEW6432%"=="AMD64" (
        echo ERROR: CryLo currently supports Windows x64 only.
        exit /b 1
    )
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo ERROR: Windows PowerShell is required to prepare the CryLo runtime.
    exit /b 1
)

if "%LOCALAPPDATA%"=="" (
    echo ERROR: LOCALAPPDATA is unavailable for the current Windows user.
    exit /b 1
)

set "CRYLO_RUNTIME_ROOT=%LOCALAPPDATA%\CryLo\runtime"

if not exist "%CRYLO_RUNTIME_ROOT%" mkdir "%CRYLO_RUNTIME_ROOT%" >nul 2>nul
if not exist "%CRYLO_RUNTIME_ROOT%" (
    echo ERROR: Unable to create the CryLo runtime directory.
    exit /b 1
)

set "CRYLO_NODE_VERSION=24.21.0"
set "CRYLO_NODE_NAME=node-v%CRYLO_NODE_VERSION%-win-x64"
set "CRYLO_NODE_SHA256=158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"
set "CRYLO_NODE_DIRECTORY=%CRYLO_RUNTIME_ROOT%\%CRYLO_NODE_NAME%"
set "CRYLO_NODE_EXE=%CRYLO_NODE_DIRECTORY%\node.exe"
set "CRYLO_NODE_URL=https://nodejs.org/dist/v%CRYLO_NODE_VERSION%/%CRYLO_NODE_NAME%.zip"

set "CRYLO_GIT_VERSION=2.55.0.5"
set "CRYLO_GIT_NAME=MinGit-%CRYLO_GIT_VERSION%-64-bit"
set "CRYLO_GIT_SHA256=56d7b226b7693196cfc71fef26568f536c4a021ab6c37ff2db4287bed908e96e"
set "CRYLO_GIT_DIRECTORY=%CRYLO_RUNTIME_ROOT%\mingit-%CRYLO_GIT_VERSION%-x64"
set "CRYLO_GIT_EXE=%CRYLO_GIT_DIRECTORY%\cmd\git.exe"
set "CRYLO_GIT_URL=https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/%CRYLO_GIT_NAME%.zip"

call :ensure_node
if errorlevel 1 exit /b %errorlevel%

call :ensure_git
if errorlevel 1 exit /b %errorlevel%

set "CRYLO_NODE_RUNTIME=%CRYLO_NODE_DIRECTORY%"
set "CRYLO_GIT_RUNTIME=%CRYLO_GIT_DIRECTORY%"
set "GIT_TERMINAL_PROMPT=0"
set "PATH=%CRYLO_GIT_DIRECTORY%\cmd;%PATH%"

"%CRYLO_NODE_EXE%" "%~dp0scripts\crylo.js" %*
exit /b %errorlevel%


:ensure_node
set "CRYLO_NODE_READY=false"

if exist "%CRYLO_NODE_EXE%" (
    "%CRYLO_NODE_EXE%" -e "process.exit(process.version === 'v%CRYLO_NODE_VERSION%' ? 0 : 1)" >nul 2>nul
    if not errorlevel 1 set "CRYLO_NODE_READY=true"
)

if "%CRYLO_NODE_READY%"=="true" exit /b 0

echo Preparing isolated CryLo Node.js %CRYLO_NODE_VERSION% runtime...

set "CRYLO_NODE_TEMP=%TEMP%\crylo-node-%RANDOM%-%RANDOM%"
set "CRYLO_NODE_ARCHIVE=%CRYLO_NODE_TEMP%\%CRYLO_NODE_NAME%.zip"

mkdir "%CRYLO_NODE_TEMP%" >nul 2>nul
if errorlevel 1 (
    echo ERROR: Unable to create the CryLo Node.js staging directory.
    exit /b 1
)

powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:CRYLO_NODE_URL -OutFile $env:CRYLO_NODE_ARCHIVE; $actual=(Get-FileHash -LiteralPath $env:CRYLO_NODE_ARCHIVE -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -ne $env:CRYLO_NODE_SHA256.ToLowerInvariant()) { throw ('CryLo Node.js SHA256 mismatch. Expected ' + $env:CRYLO_NODE_SHA256 + ', received ' + $actual) }; Expand-Archive -LiteralPath $env:CRYLO_NODE_ARCHIVE -DestinationPath $env:CRYLO_NODE_TEMP -Force; $source=Join-Path $env:CRYLO_NODE_TEMP $env:CRYLO_NODE_NAME; $node=Join-Path $source 'node.exe'; if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Downloaded CryLo Node.js runtime is incomplete.' }; $version=& $node --version; if ($version -ne ('v' + $env:CRYLO_NODE_VERSION)) { throw ('Downloaded CryLo Node.js version mismatch: ' + $version) }; if (Test-Path -LiteralPath $env:CRYLO_NODE_DIRECTORY) { Remove-Item -LiteralPath $env:CRYLO_NODE_DIRECTORY -Recurse -Force }; Move-Item -LiteralPath $source -Destination $env:CRYLO_NODE_DIRECTORY"
set "CRYLO_NODE_INSTALL_RC=%ERRORLEVEL%"

if not "%CRYLO_NODE_INSTALL_RC%"=="0" (
    rmdir /s /q "%CRYLO_NODE_TEMP%" >nul 2>nul
    echo ERROR: Unable to prepare the authenticated CryLo Node.js runtime.
    exit /b 1
)

rmdir /s /q "%CRYLO_NODE_TEMP%" >nul 2>nul

if not exist "%CRYLO_NODE_EXE%" (
    echo ERROR: CryLo Node.js runtime is unavailable after installation.
    exit /b 1
)

"%CRYLO_NODE_EXE%" -e "process.exit(process.version === 'v%CRYLO_NODE_VERSION%' ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
    echo ERROR: CryLo Node.js runtime version verification failed.
    exit /b 1
)

exit /b 0


:ensure_git
set "CRYLO_GIT_READY=false"

if exist "%CRYLO_GIT_EXE%" (
    powershell.exe -NoProfile -NonInteractive -Command "$version = (& $env:CRYLO_GIT_EXE --version 2>$null); if ($LASTEXITCODE -ne 0 -or [string]$version -ne 'git version 2.55.0.windows.5') { exit 1 }" >nul 2>nul
    if not errorlevel 1 set "CRYLO_GIT_READY=true"
)

if "%CRYLO_GIT_READY%"=="true" exit /b 0

echo Preparing isolated CryLo Git %CRYLO_GIT_VERSION% runtime...

set "CRYLO_GIT_TEMP=%TEMP%\crylo-git-%RANDOM%-%RANDOM%"
set "CRYLO_GIT_ARCHIVE=%CRYLO_GIT_TEMP%\%CRYLO_GIT_NAME%.zip"
set "CRYLO_GIT_EXTRACT=%CRYLO_GIT_TEMP%\extracted"

mkdir "%CRYLO_GIT_TEMP%" >nul 2>nul
if errorlevel 1 (
    echo ERROR: Unable to create the CryLo Git staging directory.
    exit /b 1
)

powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:CRYLO_GIT_URL -OutFile $env:CRYLO_GIT_ARCHIVE; $actual=(Get-FileHash -LiteralPath $env:CRYLO_GIT_ARCHIVE -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -ne $env:CRYLO_GIT_SHA256.ToLowerInvariant()) { throw ('CryLo Git SHA256 mismatch. Expected ' + $env:CRYLO_GIT_SHA256 + ', received ' + $actual) }; New-Item -ItemType Directory -Force -Path $env:CRYLO_GIT_EXTRACT | Out-Null; Expand-Archive -LiteralPath $env:CRYLO_GIT_ARCHIVE -DestinationPath $env:CRYLO_GIT_EXTRACT -Force; $git=Join-Path $env:CRYLO_GIT_EXTRACT 'cmd\git.exe'; if (-not (Test-Path -LiteralPath $git -PathType Leaf)) { throw 'Downloaded CryLo Git runtime is incomplete.' }; $version=& $git --version; if ($version -notmatch '2\.55\.0\.windows\.5') { throw ('Downloaded CryLo Git version mismatch: ' + $version) }; if (Test-Path -LiteralPath $env:CRYLO_GIT_DIRECTORY) { Remove-Item -LiteralPath $env:CRYLO_GIT_DIRECTORY -Recurse -Force }; Move-Item -LiteralPath $env:CRYLO_GIT_EXTRACT -Destination $env:CRYLO_GIT_DIRECTORY"
set "CRYLO_GIT_INSTALL_RC=%ERRORLEVEL%"

if not "%CRYLO_GIT_INSTALL_RC%"=="0" (
    rmdir /s /q "%CRYLO_GIT_TEMP%" >nul 2>nul
    echo ERROR: Unable to prepare the authenticated CryLo Git runtime.
    exit /b 1
)

rmdir /s /q "%CRYLO_GIT_TEMP%" >nul 2>nul

if not exist "%CRYLO_GIT_EXE%" (
    echo ERROR: CryLo Git runtime is unavailable after installation.
    exit /b 1
)

powershell.exe -NoProfile -NonInteractive -Command "$version = (& $env:CRYLO_GIT_EXE --version 2>$null); if ($LASTEXITCODE -ne 0 -or [string]$version -ne 'git version 2.55.0.windows.5') { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo ERROR: CryLo Git runtime version verification failed.
    exit /b 1
)

exit /b 0
