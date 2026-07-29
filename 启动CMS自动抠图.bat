@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title CMS 自动抠图

echo.
echo ==========================================
echo   CMS 自动抠图机
echo   Rembg :7000 + Worker (轮询 CMS 抠图)
echo ==========================================
echo.
echo [1/2] 启动 Rembg 抠图服务...
start "Rembg (7000)" /min cmd /c "%~dp0启动Rembg抠图服务.bat"

timeout /t 5 /nobreak >nul

echo.
echo [2/2] 启动抠图工作脚本（轮询 CMS 待抠图作品）...
echo.

node scripts/local-cutout-worker.js

echo.
echo 抠图机已停止。
pause
