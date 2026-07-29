@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title AI Art 本地调试

echo.
echo ==========================================
echo   本地调试环境
echo   Rembg :7000 + 主服务 :3000 (自动抠图)
echo ==========================================
echo.
echo [0/2] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

echo.
echo [1/2] 启动 Rembg 抠图服务...
start "Rembg (7000)" /min cmd /c "%~dp0启动Rembg抠图服务.bat"

timeout /t 5 /nobreak >nul

echo.
echo [2/2] 启动主服务（自动抠图模式）...
echo.

set ENABLE_AUTO_CUTOUT=true
node server.js

echo.
echo 服务已停止。
pause
