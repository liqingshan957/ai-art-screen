@echo off
cd /d "%~dp0"
title CMS 自动抠图

if not exist "scriptslocal-cutout-config.json" (
    echo.
    echo ==============================================
    echo   ? 首次使用需要配置
    echo.
    echo   正在启动配置向导...
    echo ==============================================
    echo.
    node scripts/setup-config.js
    if errorlevel 1 (
        echo.
        echo 配置未完成，按任意键退出。
        pause >nul
        exit /b 1
    )
    if not exist "scriptslocal-cutout-config.json" (
        echo.
        echo 配置已取消，按任意键退出。
        pause >nul
        exit /b 1
    )
    echo.
)

echo.
echo ==========================================
echo   CMS 自动抠图机
echo   Rembg :7000 + Worker (轮询 CMS 抠图)
echo ==========================================
echo.

echo [1/2] 启动 Rembg 抠图服务...
start "Rembg(7000)" /min cmd /c "%~dp0启动Rembg抠图服务.bat"

timeout /t 5 /nobreak >nul

echo.
echo [2/2] 启动抠图工作脚本（轮询 CMS 待抠图作品）...
echo.

node scripts/local-cutout-worker.js

echo.
echo 抠图机已停止。
pause