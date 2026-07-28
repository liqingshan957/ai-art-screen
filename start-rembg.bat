@echo off
cd /d "%~dp0.."
chcp 65001 >nul 2>nul
title Rembg Server (port 7000) - No UI

set U2NET_HOME=%CD%\services\rembg\model_cache

echo.
echo ==========================================
echo   Rembg Python Server (port 7000)
echo ==========================================
echo   Model cache: %U2NET_HOME%
echo ==========================================
echo.

:loop
echo [%time%] Starting Python rembg server...
python "%CD%\services\rembg\rembg-server.py"
echo.
echo [%time%] Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop