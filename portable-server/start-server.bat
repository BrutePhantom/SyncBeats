@echo off
setlocal enabledelayedexpansion
title Syncbeats Host Server

cd /d "%~dp0"

echo ======================================================================
echo                 SYNCBEATS PORTABLE HOST SERVER
echo ======================================================================
echo.

:: 1. Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js was not found on your system PATH.
    echo.
    if exist "bin\node.exe" (
        echo [*] Found portable Node runtime in .\bin\node.exe
        set "NODE_CMD=bin\node.exe"
    ) else (
        echo [*] Downloading lightweight portable Node runtime...
        mkdir bin 2>nul
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/win-x64/node.exe', 'bin\node.exe')"
        if exist "bin\node.exe" (
            echo [*] Portable Node.js downloaded successfully!
            set "NODE_CMD=bin\node.exe"
        ) else (
            echo [!] Automatic download failed. Please install Node.js from https://nodejs.org
            pause
            exit /b 1
        )
    )
) else (
    set "NODE_CMD=node"
)

:: 2. Check if node_modules exists
if not exist "node_modules\" (
    echo [*] First-time setup: Installing required dependencies...
    where npm >nul 2>nul
    if %errorlevel% equ 0 (
        call npm install --omit=dev
        call npx prisma generate
    ) else (
        echo [!] npm not found. Please ensure Node.js is installed with npm.
        pause
        exit /b 1
    )
)

:: 3. Detect and display local network IP
for /f "tokens=*" %%a in ('powershell -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Virtual|Loopback|Pseudo' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress | Select-Object -First 1"') do set "LOCAL_IP=%%a"

if "!LOCAL_IP!"=="" (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
        if "!LOCAL_IP!"=="" set "LOCAL_IP=%%a"
    )
    set "LOCAL_IP=!LOCAL_IP: =!"
)

echo.
echo ======================================================================
echo   SERVER STATUS:  ONLINE
echo   Local Address:  http://localhost:5000
if not "!LOCAL_IP!"=="" (
    echo   LAN Address:    http://!LOCAL_IP!:5000
)
echo   Songs Folder:   %~dp0public\songs
echo ======================================================================
echo   * Anyone on your Wi-Fi will auto-connect via the Syncbeats App!
if not "!LOCAL_IP!"=="" (
    echo   * Or they can connect manually to: http://!LOCAL_IP!:5000
)
echo   * Drop any .mp3/.wav/.m4a files into 'public\songs' to add tracks.
echo   * Keep this terminal window open while hosting.
echo ======================================================================
echo.

"%NODE_CMD%" index.js
pause
