@echo off
cd /d "%~dp0"
title Rembg Server (port 7000) - No UI

set U2NET_HOME=%CD%\test-rembg\model_cache

echo.
echo ==========================================
echo   Rembg Custom Python Server
echo ==========================================
echo   Port:  7000
echo   Model: U2-Net (cached in %U2NET_HOME%)
echo   UI:    None (pure Python HTTP server)
echo.
echo   Crash-restart loop enabled
echo   Press Ctrl+C multiple times to stop
echo ==========================================
echo.

:loop
echo [%time%] Starting Python rembg server...
"C:\Users\12549\.workbuddy\binaries\python\envs\default\Scripts\python.exe" "%~dp0test-rembg\rembg-server.py"
echo.
echo [%time%] Server stopped! Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
