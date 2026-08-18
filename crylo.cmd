@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is required to build CryLo.
    exit /b 1
)

node "%~dp0scripts\release\crylo-release.js" %*
exit /b %errorlevel%