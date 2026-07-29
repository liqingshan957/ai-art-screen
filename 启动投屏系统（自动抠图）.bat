@echo off
cd /d "%~dp0"
title 敦煌AIGC·自动抠图投屏系统

echo ======================================================
echo    敦煌 AIGC 艺术展 · 本地投屏系统
echo    Rembg(7000) + Node(3000)  [自动抠图模式]
echo ======================================================
echo.

rem ---- 1. 清理端口 ----
echo [1/3] 清理端口...
echo.

powershell -NoProfile -Command "3000,7000 | ForEach-Object { try { `$p=`$_; Get-NetTCPConnection -LocalPort `$_ -ErrorAction Stop | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force; Write-Host \"  [OK] 端口 `$p 已释放\" } } catch {} }" 2>nul

timeout /t 1 /nobreak >nul

rem ---- 2. 启动 Rembg ----
echo.
echo [2/3] 启动 Rembg 抠图服务...
echo.

start "Rembg(7000)" /min cmd /c "启动Rembg抠图服务.bat"

setlocal enabledelayedexpansion
set "ready="
for /l %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { `$r=Invoke-WebRequest -Uri 'http://localhost:7000/api/remove' -Method Options -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
        set ready=1
        goto :rembg_ready
    )
)
:rembg_ready
if defined ready (
    echo   [OK] Rembg 抠图服务已就绪 (http://localhost:7000)
) else (
    echo   [..] Rembg 未就绪（主服务仍将继续启动）
)

rem ---- 3. 展示服务链接 + 启动主服务 ----
echo.
echo [3/3] 启动主服务...
echo.
echo ======================================================
echo  服务访问地址
echo.
echo   大屏展示  http://localhost:3000/display
echo   画廊首页  http://localhost:3000/gallery
echo   管理后台  http://localhost:3000/admin
echo   运营看板  http://localhost:3000/dashboard
echo   Rembg     http://localhost:7000
echo.
echo  Ctrl+C 停止服务
echo ======================================================
echo.

set ENABLE_AUTO_CUTOUT=true
node server.js

echo.
echo 服务已停止。
pause
