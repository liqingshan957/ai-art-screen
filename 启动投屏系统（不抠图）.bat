@echo off
cd /d "%~dp0"
title 敦煌AIGC·投屏系统（不抠图）

echo ======================================================
echo    敦煌 AIGC 艺术展 · 投屏系统
echo    Rembg(7000) + Node(3000)  [不抠图模式 / 展览现场]
echo ======================================================
echo.

rem ---- 1. 清理端口 ----
echo [1/4] 清理端口...
echo.

powershell -NoProfile -Command "3000,7000 | ForEach-Object { try { `$p=`$_; Get-NetTCPConnection -LocalPort `$_ -ErrorAction Stop | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force; Write-Host \"  [OK] 端口 `$p 已释放\" } } catch {} }" 2>nul

timeout /t 1 /nobreak >nul

rem ---- 2. 启动 Rembg ----
echo.
echo [2/4] 启动 Rembg 抠图服务...
echo.

start "Rembg(7000)" /min cmd /c "启动Rembg抠图服务.bat"

echo   ...等待 Rembg 加载模型（首次下载约 1-2 分钟）
setlocal enabledelayedexpansion
set "ready="
for /l %%i in (1,1,60) do (
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:7000/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
        set ready=1
        goto :rembg_ready
    )
)
:rembg_ready
if defined ready (
    echo   [OK] Rembg 抠图服务已就绪
) else (
    echo   [..] Rembg 未就绪（后台继续加载中，不影响首次连接）
)
endlocal

rem ---- 3. 启动主服务（后台） ----
echo.
echo [3/4] 启动投屏服务...
echo.

start "Screen(3000)" /min cmd /c "title Screen(3000) && node server.js"
timeout /t 3 /nobreak >nul

rem ---- 4. 验证状态 ----
echo [4/4] 验证服务状态...
echo.

setlocal enabledelayedexpansion
set "svr_ok="
set "rembg_ok="

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000/api/artworks' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if !errorlevel! equ 0 (set "svr_ok=1") else (set "svr_ok=")
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:7000/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if !errorlevel! equ 0 (set "rembg_ok=1") else (set "rembg_ok=")

if defined svr_ok (echo   [OK] 投屏服务(3000):  运行中) else (echo   [XX] 投屏服务(3000):  未响应)
if defined rembg_ok (echo   [OK] Rembg(7000):     运行中) else (echo   [XX] Rembg(7000):     未响应)
endlocal

echo.
echo ======================================================
echo  服务访问地址
echo.
echo   大屏展示  http://localhost:3000/display
echo   画廊首页  http://localhost:3000/gallery
echo   管理后台  http://localhost:3000/admin
echo   运营看板  http://localhost:3000/dashboard
echo.
echo  服务在后台运行，关闭本窗口不影响
echo ======================================================
echo.

pause
