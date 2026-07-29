@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title Rembg 抠图服务 (7000)

set U2NET_HOME=%CD%\services\rembg\model_cache

echo.
echo ==========================================
echo   Rembg Python 抠图服务
echo   端口: 7000
echo   模型: u2net
echo ==========================================
echo.

:loop
echo [%time%] 启动 Python rembg 服务...
python "%CD%\services\rembg\rembg-server.py"
echo.
echo [%time%] 服务异常退出，3 秒后重启...
timeout /t 3 /nobreak >nul
goto loop
