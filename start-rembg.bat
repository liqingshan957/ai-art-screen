@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title Rembg Server (port 7000) - No UI

set U2NET_HOME=%CD%\test-rembg\model_cache

echo.
echo ==========================================
echo   Rembg Python ????
echo ==========================================
echo   ??:  7000
echo   ??: U2-Net (????: %U2NET_HOME%)
echo ==========================================
echo.

:loop
echo [%time%] ?? Python rembg ??...
python "%~dp0test-rembg\rembg-server.py"
echo.
echo [%time%] ?????3??????...
timeout /t 3 /nobreak >nul
goto loop
