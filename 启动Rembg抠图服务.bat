@echo off
cd /d "%~dp0"
title Rembg 抠图服务 (7000)

set U2NET_HOME=%CD%\services\rembg\model_cache

if not exist "%CD%\logs" mkdir "%CD%\logs"

echo.
echo ==========================================
echo   Rembg Python 抠图服务
echo   端口: 7000
echo   模型: u2net
echo   日志: logs\rembg.log
echo ==========================================
echo.

echo [%date% %time%] ===== Rembg 服务启动 ===== >> "%CD%\logs\rembg.log"

:loop
echo [%time%] 启动 Python rembg 服务...
echo [%date% %time%] 启动中... >> "%CD%\logs\rembg.log"
python "%CD%\services\rembg\rembg-server.py" >> "%CD%\logs\rembg.log" 2>&1
echo [%time%] 服务异常退出，3 秒后重启...
echo [%date% %time%] 异常退出，重启中... >> "%CD%\logs\rembg.log"
timeout /t 3 /nobreak >nul
goto loop
