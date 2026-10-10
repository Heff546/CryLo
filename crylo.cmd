@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if /I not "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    if /I not "%PROCESSOR_ARCHITEW6432%"=="AMD64" (
        echo ERROR: CryLo currently supports Windows x64 only.
        exit /b 1
    )
)

set "CRYLO_WINDOWS_ROOT=%SystemRoot%"
if not defined CRYLO_WINDOWS_ROOT set "CRYLO_WINDOWS_ROOT=%WINDIR%"
if not defined CRYLO_WINDOWS_ROOT set "CRYLO_WINDOWS_ROOT=C:\Windows"
set "CRYLO_POWERSHELL=%CRYLO_WINDOWS_ROOT%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%CRYLO_POWERSHELL%" (
    echo ERROR: The trusted Windows PowerShell executable was not found.
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
set "CRYLO_NODE_EXE_SHA256=ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32"
set "CRYLO_NODE_DIRECTORY=%CRYLO_RUNTIME_ROOT%\%CRYLO_NODE_NAME%"
set "CRYLO_NODE_BACKUP=%CRYLO_RUNTIME_ROOT%\%CRYLO_NODE_NAME%.pre-crylo-bootstrap"
set "CRYLO_NODE_EXE=%CRYLO_NODE_DIRECTORY%\node.exe"
set "CRYLO_NPM_VERSION=12.1.0"
set "CRYLO_NPM_CMD=%CRYLO_NODE_DIRECTORY%\npm.cmd"
set "CRYLO_NPM_CLI=%CRYLO_NODE_DIRECTORY%\node_modules\npm\bin\npm-cli.js"
set "CRYLO_NODE_URL=https://nodejs.org/dist/v%CRYLO_NODE_VERSION%/%CRYLO_NODE_NAME%.zip"

set "CRYLO_GIT_VERSION=2.56.0"
set "CRYLO_GIT_BUILD=2.56.0.windows.1"
set "CRYLO_GIT_NAME=MinGit-%CRYLO_GIT_VERSION%-64-bit"
set "CRYLO_GIT_SHA256=064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718"
set "CRYLO_GIT_DIRECTORY=%CRYLO_RUNTIME_ROOT%\mingit-%CRYLO_GIT_BUILD%-x64"
set "CRYLO_GIT_BACKUP=%CRYLO_RUNTIME_ROOT%\mingit-%CRYLO_GIT_BUILD%-x64.pre-crylo-bootstrap"
set "CRYLO_GIT_EXE=%CRYLO_GIT_DIRECTORY%\cmd\git.exe"
set "CRYLO_GIT_URL=https://github.com/git-for-windows/git/releases/download/v%CRYLO_GIT_BUILD%/%CRYLO_GIT_NAME%.zip"

call :ensure_node
if errorlevel 1 exit /b %errorlevel%

call :ensure_npm
if errorlevel 1 exit /b %errorlevel%

call :ensure_git
if errorlevel 1 exit /b %errorlevel%

set "CRYLO_NODE_RUNTIME=%CRYLO_NODE_DIRECTORY%"
set "CRYLO_GIT_RUNTIME=%CRYLO_GIT_DIRECTORY%"
set "GIT_TERMINAL_PROMPT=0"
set "PATH=%CRYLO_NODE_DIRECTORY%;%CRYLO_GIT_DIRECTORY%\cmd;%PATH%"

"%CRYLO_NODE_EXE%" "%~dp0scripts\crylo.js" %*
exit /b %errorlevel%


:ensure_node
if exist "%CRYLO_NODE_BACKUP%" (
    echo ERROR: A CryLo Node.js recovery backup already exists:
    echo %CRYLO_NODE_BACKUP%
    echo Resolve the preserved recovery state before retrying CryLo.
    exit /b 1
)

set "CRYLO_NODE_READY=false"

if exist "%CRYLO_NODE_EXE%" (
    "%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $d=$env:CRYLO_NODE_DIRECTORY; $n=$env:CRYLO_NODE_EXE; if (-not (Test-Path -LiteralPath $d -PathType Container) -or -not (Test-Path -LiteralPath $n -PathType Leaf)) { exit 1 }; $di=Get-Item -LiteralPath $d -Force; $ni=Get-Item -LiteralPath $n -Force; if (($di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($ni.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $r=Get-ChildItem -LiteralPath $d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $r) { exit 1 }; $h=(Get-FileHash -LiteralPath $n -Algorithm SHA256).Hash.ToLowerInvariant(); if ($h -ne $env:CRYLO_NODE_EXE_SHA256.ToLowerInvariant()) { exit 1 }; $v=(& $n --version).Trim(); if ($LASTEXITCODE -ne 0 -or $v -ne ('v' + $env:CRYLO_NODE_VERSION)) { exit 1 }; $a=(& $n -p 'process.arch').Trim(); if ($LASTEXITCODE -ne 0 -or $a -ne 'x64') { exit 1 }; exit 0" >nul 2>nul
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

"%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:CRYLO_NODE_URL -OutFile $env:CRYLO_NODE_ARCHIVE; $archiveHash=(Get-FileHash -LiteralPath $env:CRYLO_NODE_ARCHIVE -Algorithm SHA256).Hash.ToLowerInvariant(); if ($archiveHash -ne $env:CRYLO_NODE_SHA256.ToLowerInvariant()) { throw ('CryLo Node.js archive SHA256 mismatch. Expected ' + $env:CRYLO_NODE_SHA256 + ', received ' + $archiveHash) }; Expand-Archive -LiteralPath $env:CRYLO_NODE_ARCHIVE -DestinationPath $env:CRYLO_NODE_TEMP -Force; $source=Join-Path $env:CRYLO_NODE_TEMP $env:CRYLO_NODE_NAME; $final=$env:CRYLO_NODE_DIRECTORY; $backup=$env:CRYLO_NODE_BACKUP; $node=Join-Path $source 'node.exe'; if (-not (Test-Path -LiteralPath $source -PathType Container) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Downloaded CryLo Node.js runtime is incomplete.' }; $si=Get-Item -LiteralPath $source -Force; $ni=Get-Item -LiteralPath $node -Force; if (($si.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($ni.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Downloaded CryLo Node.js runtime contains a reparse point.' }; $rp=Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $rp) { throw 'Downloaded CryLo Node.js runtime tree contains a reparse point.' }; $nodeHash=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant(); if ($nodeHash -ne $env:CRYLO_NODE_EXE_SHA256.ToLowerInvariant()) { throw ('Downloaded CryLo node.exe SHA256 mismatch. Expected ' + $env:CRYLO_NODE_EXE_SHA256 + ', received ' + $nodeHash) }; $version=(& $node --version).Trim(); if ($LASTEXITCODE -ne 0 -or $version -ne ('v' + $env:CRYLO_NODE_VERSION)) { throw ('Downloaded CryLo Node.js version mismatch: ' + $version) }; $arch=(& $node -p 'process.arch').Trim(); if ($LASTEXITCODE -ne 0 -or $arch -ne 'x64') { throw ('Downloaded CryLo Node.js architecture mismatch: ' + $arch) }; $cryloRoot=[System.IO.Path]::GetDirectoryName($env:CRYLO_RUNTIME_ROOT); foreach ($p in @($cryloRoot,$env:CRYLO_RUNTIME_ROOT,$final)) { if (Test-Path -LiteralPath $p) { $i=Get-Item -LiteralPath $p -Force; if (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('CryLo runtime path is a reparse point: ' + $p) } } }; if (Test-Path -LiteralPath $backup) { throw ('CryLo Node.js recovery backup already exists: ' + $backup) }; $hadOld=Test-Path -LiteralPath $final; $backedUp=$false; try { if ($hadOld) { $oldRp=Get-ChildItem -LiteralPath $final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $oldRp) { throw 'Existing CryLo Node.js runtime contains a reparse point.' }; Move-Item -LiteralPath $final -Destination $backup; $backedUp=$true }; Move-Item -LiteralPath $source -Destination $final; $installedNode=Join-Path $final 'node.exe'; if (-not (Test-Path -LiteralPath $installedNode -PathType Leaf)) { throw 'Installed CryLo Node.js runtime is incomplete.' }; $installedHash=(Get-FileHash -LiteralPath $installedNode -Algorithm SHA256).Hash.ToLowerInvariant(); if ($installedHash -ne $env:CRYLO_NODE_EXE_SHA256.ToLowerInvariant()) { throw 'Installed CryLo node.exe SHA256 mismatch.' }; $installedVersion=(& $installedNode --version).Trim(); if ($LASTEXITCODE -ne 0 -or $installedVersion -ne ('v' + $env:CRYLO_NODE_VERSION)) { throw 'Installed CryLo Node.js version mismatch.' }; $installedArch=(& $installedNode -p 'process.arch').Trim(); if ($LASTEXITCODE -ne 0 -or $installedArch -ne 'x64') { throw 'Installed CryLo Node.js architecture mismatch.' }; if ($hadOld) { Remove-Item -LiteralPath $backup -Recurse -Force }; exit 0 } catch { if ($backedUp) { if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Recurse -Force -ErrorAction SilentlyContinue }; if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $final)) { Move-Item -LiteralPath $backup -Destination $final -ErrorAction SilentlyContinue } } elseif (-not $hadOld -and (Test-Path -LiteralPath $final)) { Remove-Item -LiteralPath $final -Recurse -Force -ErrorAction SilentlyContinue }; throw }"
set "CRYLO_NODE_INSTALL_RC=%ERRORLEVEL%"

rmdir /s /q "%CRYLO_NODE_TEMP%" >nul 2>nul

if not "%CRYLO_NODE_INSTALL_RC%"=="0" (
    echo ERROR: Unable to prepare the authenticated CryLo Node.js runtime.
    echo Any previous CryLo-managed Node.js runtime was preserved or restored.
    exit /b 1
)

if not exist "%CRYLO_NODE_EXE%" (
    echo ERROR: CryLo Node.js runtime is unavailable after installation.
    exit /b 1
)

"%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $n=$env:CRYLO_NODE_EXE; $h=(Get-FileHash -LiteralPath $n -Algorithm SHA256).Hash.ToLowerInvariant(); if ($h -ne $env:CRYLO_NODE_EXE_SHA256.ToLowerInvariant()) { exit 1 }; $v=(& $n --version).Trim(); if ($LASTEXITCODE -ne 0 -or $v -ne ('v' + $env:CRYLO_NODE_VERSION)) { exit 1 }; $a=(& $n -p 'process.arch').Trim(); if ($LASTEXITCODE -ne 0 -or $a -ne 'x64') { exit 1 }; exit 0" >nul 2>nul
if errorlevel 1 (
    echo ERROR: CryLo Node.js runtime final verification failed.
    exit /b 1
)

exit /b 0


:ensure_npm
set "CRYLO_NPM_READY=false"

if exist "%CRYLO_NPM_CMD%" if exist "%CRYLO_NPM_CLI%" (
    "%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$version=(& $env:CRYLO_NODE_EXE $env:CRYLO_NPM_CLI --version 2>$null); if ($LASTEXITCODE -ne 0 -or [string]$version -ne $env:CRYLO_NPM_VERSION) { exit 1 }" >nul 2>nul
    if not errorlevel 1 set "CRYLO_NPM_READY=true"
)

if "%CRYLO_NPM_READY%"=="true" exit /b 0

if not exist "%CRYLO_NPM_CLI%" (
    echo ERROR: CryLo bundled npm CLI is unavailable.
    exit /b 1
)

echo Preparing isolated CryLo npm %CRYLO_NPM_VERSION% runtime...

"%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $final=$env:CRYLO_NODE_DIRECTORY; $backup=$env:CRYLO_NODE_BACKUP; $node=Join-Path $final 'node.exe'; $cli=Join-Path $final 'node_modules\npm\bin\npm-cli.js'; if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'CryLo Node.js/npm runtime is incomplete.' }; if (Test-Path -LiteralPath $backup) { throw ('CryLo Node.js recovery backup already exists: ' + $backup) }; $rp=Get-ChildItem -LiteralPath $final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $rp) { throw 'Existing CryLo Node.js/npm runtime contains a reparse point.' }; Move-Item -LiteralPath $final -Destination $backup; $backedUp=$true; try { Copy-Item -LiteralPath $backup -Destination $final -Recurse -Force; $node=Join-Path $final 'node.exe'; $cli=Join-Path $final 'node_modules\npm\bin\npm-cli.js'; & $node $cli install --global --prefix $final --no-audit --no-fund --ignore-scripts ('npm@' + $env:CRYLO_NPM_VERSION); if ($LASTEXITCODE -ne 0) { throw 'CryLo npm installation failed.' }; $newCli=Join-Path $final 'node_modules\npm\bin\npm-cli.js'; if (-not (Test-Path -LiteralPath $newCli -PathType Leaf)) { throw 'CryLo npm runtime is unavailable after installation.' }; $version=(& $node $newCli --version).Trim(); if ($LASTEXITCODE -ne 0 -or $version -ne $env:CRYLO_NPM_VERSION) { throw ('CryLo npm version mismatch: ' + $version) }; $nodeHash=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant(); if ($nodeHash -ne $env:CRYLO_NODE_EXE_SHA256.ToLowerInvariant()) { throw 'CryLo node.exe changed during npm installation.' }; Remove-Item -LiteralPath $backup -Recurse -Force; exit 0 } catch { if ($backedUp -and (Test-Path -LiteralPath $final)) { Remove-Item -LiteralPath $final -Recurse -Force -ErrorAction SilentlyContinue }; if ($backedUp -and (Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $final)) { Move-Item -LiteralPath $backup -Destination $final -ErrorAction SilentlyContinue }; throw }"
set "CRYLO_NPM_INSTALL_RC=%ERRORLEVEL%"

if not "%CRYLO_NPM_INSTALL_RC%"=="0" (
    echo ERROR: Unable to prepare the isolated CryLo npm runtime.
    echo The previous CryLo-managed Node.js/npm runtime was restored when possible.
    exit /b 1
)

if not exist "%CRYLO_NPM_CMD%" (
    echo ERROR: CryLo npm command wrapper is unavailable after installation.
    exit /b 1
)

if not exist "%CRYLO_NPM_CLI%" (
    echo ERROR: CryLo npm runtime is unavailable after installation.
    exit /b 1
)

"%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$version=(& $env:CRYLO_NODE_EXE $env:CRYLO_NPM_CLI --version 2>$null); if ($LASTEXITCODE -ne 0 -or [string]$version -ne $env:CRYLO_NPM_VERSION) { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo ERROR: CryLo npm runtime version verification failed.
    exit /b 1
)

exit /b 0


:ensure_git
if exist "%CRYLO_GIT_BACKUP%" (
    echo ERROR: A CryLo Git recovery backup already exists:
    echo %CRYLO_GIT_BACKUP%
    echo Resolve the preserved recovery state before retrying CryLo.
    exit /b 1
)

set "CRYLO_GIT_READY=false"

if exist "%CRYLO_GIT_EXE%" (
    "%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $d=$env:CRYLO_GIT_DIRECTORY; $g=$env:CRYLO_GIT_EXE; if (-not (Test-Path -LiteralPath $d -PathType Container) -or -not (Test-Path -LiteralPath $g -PathType Leaf)) { exit 1 }; $di=Get-Item -LiteralPath $d -Force; $gi=Get-Item -LiteralPath $g -Force; if (($di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($gi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $r=Get-ChildItem -LiteralPath $d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $r) { exit 1 }; $version=(& $g --version).Trim(); if ($LASTEXITCODE -ne 0 -or $version -ne ('git version ' + $env:CRYLO_GIT_BUILD)) { exit 1 }; exit 0" >nul 2>nul
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

"%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:CRYLO_GIT_URL -OutFile $env:CRYLO_GIT_ARCHIVE; $archiveHash=(Get-FileHash -LiteralPath $env:CRYLO_GIT_ARCHIVE -Algorithm SHA256).Hash.ToLowerInvariant(); if ($archiveHash -ne $env:CRYLO_GIT_SHA256.ToLowerInvariant()) { throw ('CryLo Git archive SHA256 mismatch. Expected ' + $env:CRYLO_GIT_SHA256 + ', received ' + $archiveHash) }; New-Item -ItemType Directory -Force -Path $env:CRYLO_GIT_EXTRACT | Out-Null; Expand-Archive -LiteralPath $env:CRYLO_GIT_ARCHIVE -DestinationPath $env:CRYLO_GIT_EXTRACT -Force; $source=$env:CRYLO_GIT_EXTRACT; $final=$env:CRYLO_GIT_DIRECTORY; $backup=$env:CRYLO_GIT_BACKUP; $git=Join-Path $source 'cmd\git.exe'; if (-not (Test-Path -LiteralPath $git -PathType Leaf)) { throw 'Downloaded CryLo Git runtime is incomplete.' }; $si=Get-Item -LiteralPath $source -Force; $gi=Get-Item -LiteralPath $git -Force; if (($si.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($gi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Downloaded CryLo Git runtime contains a reparse point.' }; $rp=Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $rp) { throw 'Downloaded CryLo Git runtime tree contains a reparse point.' }; $version=(& $git --version).Trim(); if ($LASTEXITCODE -ne 0 -or $version -ne ('git version ' + $env:CRYLO_GIT_BUILD)) { throw ('Downloaded CryLo Git version mismatch: ' + $version) }; $cryloRoot=[System.IO.Path]::GetDirectoryName($env:CRYLO_RUNTIME_ROOT); foreach ($p in @($cryloRoot,$env:CRYLO_RUNTIME_ROOT,$final)) { if (Test-Path -LiteralPath $p) { $i=Get-Item -LiteralPath $p -Force; if (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('CryLo runtime path is a reparse point: ' + $p) } } }; if (Test-Path -LiteralPath $backup) { throw ('CryLo Git recovery backup already exists: ' + $backup) }; $hadOld=Test-Path -LiteralPath $final; $backedUp=$false; try { if ($hadOld) { $oldRp=Get-ChildItem -LiteralPath $final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $oldRp) { throw 'Existing CryLo Git runtime contains a reparse point.' }; Move-Item -LiteralPath $final -Destination $backup; $backedUp=$true }; Move-Item -LiteralPath $source -Destination $final; $installedGit=Join-Path $final 'cmd\git.exe'; if (-not (Test-Path -LiteralPath $installedGit -PathType Leaf)) { throw 'Installed CryLo Git runtime is incomplete.' }; $installedVersion=(& $installedGit --version).Trim(); if ($LASTEXITCODE -ne 0 -or $installedVersion -ne ('git version ' + $env:CRYLO_GIT_BUILD)) { throw 'Installed CryLo Git version mismatch.' }; if ($hadOld) { Remove-Item -LiteralPath $backup -Recurse -Force }; exit 0 } catch { if ($backedUp) { if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Recurse -Force -ErrorAction SilentlyContinue }; if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $final)) { Move-Item -LiteralPath $backup -Destination $final -ErrorAction SilentlyContinue } } elseif (-not $hadOld -and (Test-Path -LiteralPath $final)) { Remove-Item -LiteralPath $final -Recurse -Force -ErrorAction SilentlyContinue }; throw }"
set "CRYLO_GIT_INSTALL_RC=%ERRORLEVEL%"

rmdir /s /q "%CRYLO_GIT_TEMP%" >nul 2>nul

if not "%CRYLO_GIT_INSTALL_RC%"=="0" (
    echo ERROR: Unable to prepare the authenticated CryLo Git runtime.
    echo Any previous CryLo-managed Git runtime was preserved or restored.
    exit /b 1
)

if not exist "%CRYLO_GIT_EXE%" (
    echo ERROR: CryLo Git runtime is unavailable after installation.
    exit /b 1
)

"%CRYLO_POWERSHELL%" -NoProfile -NonInteractive -Command "$version=(& $env:CRYLO_GIT_EXE --version 2>$null); if ($LASTEXITCODE -ne 0 -or [string]$version -ne ('git version ' + $env:CRYLO_GIT_BUILD)) { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo ERROR: CryLo Git runtime version verification failed.
    exit /b 1
)

exit /b 0
