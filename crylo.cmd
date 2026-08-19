@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is required to run CryLo.
    exit /b 1
)

node "%~dp0scripts\crylo.js" %*
exit /b %errorlevel%
