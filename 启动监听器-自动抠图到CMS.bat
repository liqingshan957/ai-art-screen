@echo off
cd /d "%~dp0"
title 监听器-自动抠图到CMS

rem ---- 首次使用配置 ----
if not exist "scripts\local-cutout-config.json" (
    echo ======================================================
    echo   首次使用需要配置
    echo   请按照向导输入 CMS 连接信息...
    echo ======================================================
    echo.
    node scripts/setup-config.js
    if errorlevel 1 (
        echo.
        echo [XX] 配置未完成，已退出。
        pause >nul
        exit /b 1
    )
    if not exist "scripts\local-cutout-config.json" (
        echo.
        echo [XX] 配置已取消，退出。
        pause >nul
        exit /b 1
    )
    echo.
)

rem ---- 启动服务 ----
echo ======================================================
echo    CMS 自动抠图
echo    Rembg(7000) + Worker(轮询 CMS 抠图)
echo ======================================================
echo.

rem 清理 Rembg 端口
echo [1/2] 启动 Rembg 抠图服务...
echo.
powershell -NoProfile -Command "try { `$p=7000; Get-NetTCPConnection -LocalPort `$p -ErrorAction Stop | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force; Write-Host \"  [OK] 端口 `$p 已释放\" } } catch {}" 2>nul

start "Rembg(7000)" /min cmd /c "启动Rembg抠图服务.bat"
timeout /t 5 /nobreak >nul

echo.
echo [2/2] 启动抠图工作脚本...
echo.
echo   轮询 CMS 相册 -> 下载原图 -> Rembg 抠图 -> 上传回 CMS
echo.
echo ======================================================
echo   工作脚本在前台运行
echo   按 Ctrl+C 可停止
echo ======================================================
echo.

node scripts/local-cutout-worker.js

echo.
echo 抠图进程已停止。
pause
