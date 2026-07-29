@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title 敦煌AI艺术展 - 投屏系统

echo.
echo ==============================================
echo   敦煌AIGC艺术展 · 投屏展示系统
echo ==============================================
echo.

echo [1/4] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

echo.
echo [2/4] 启动 Rembg 抠图服务 (端口 7000)...
start "Rembg (7000)" /min cmd /c "%~dp0启动Rembg抠图服务.bat"

echo  等待 Rembg 就绪（首次启动需下载模型，可能需1-2分钟）...
for /l %%i in (1,1,120) do (
    timeout /t 1 /nobreak >nul
    curl -s http://localhost:7000/health >nul 2>&1
    if not errorlevel 1 (
        echo  ✅ Rembg 已就绪
        goto rembg_ready
    )
)
echo  ⚠️ Rembg 启动超时（可能在后台继续加载，稍后可用）
:rembg_ready

echo.
echo [3/4] 启动投屏主服务 (端口 3000)...
start "Screen (3000)" /min cmd /c "title Screen(3000) && node server.js"
timeout /t 3 /nobreak >nul

echo.
echo [4/4] 验证服务状态...
>nul 2>&1 curl -s http://localhost:7000/health && echo  ✅ Rembg (7000): 运行中 || echo  ❌ Rembg (7000): 未就绪
>nul 2>&1 curl -s http://localhost:3000/api/artworks && echo  ✅ 投屏系统 (3000): 运行中 || echo  ❌ 投屏系统 (3000): 未就绪

echo.
echo ==============================================
echo   全部服务已启动！
echo ==============================================
echo.
echo   大屏展示:  http://localhost:3000/display
echo   后台管理:  http://localhost:3000/admin
echo   数据看板:  http://localhost:3000/dashboard
echo.
echo   2个最小化窗口在后台运行，关闭本窗口不影响服务。
echo.
pause
