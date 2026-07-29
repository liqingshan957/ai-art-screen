@echo off
cd /d "%~dp0"
title Rembg 抠图服务 (7000)

set U2NET_HOME=%CD%\services\rembg\model_cache

if not exist "%CD%\logs" mkdir "%CD%\logs"

echo ======================================================
echo    Rembg Python 抠图服务
echo    端口: 7000  模型: u2net
echo    日志: logs\rembg.log
echo ======================================================
echo.

echo [%date% %time%] ===== Rembg 服务启动 ===== >> "%CD%\logs\rembg.log"

echo   [..] 服务监听中... http://localhost:7000
echo.
echo   按 Ctrl+C 停止（会自动重启）
echo.

:loop
python "%CD%\services\rembg\rembg-server.py" >> "%CD%\logs\rembg.log" 2>&1
echo   [!!] 进程异常退出（%date% %time%），3 秒后重启...
echo [%date% %time%] 异常退出，即将重启 >> "%CD%\logs\rembg.log"
timeout /t 3 /nobreak >nul
echo   [..] 正在重启...
goto loop
