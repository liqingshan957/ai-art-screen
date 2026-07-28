@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo ==============================================
echo    敦煌AIGC艺术展 - 投屏系统
echo    Dunhuang AIGC Art Exhibition
echo ==============================================
echo.
echo [1/6] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

echo.
echo [2/6] 启动 Rembg 抠图服务 (端口 7000)...
start "Rembg (7000)" /min "%~dp0start-rembg.bat"

echo  等待 Rembg 就绪（首次启动需下载模型，可能需1-2分钟）...
set REMBG_READY=0
for /l %%i in (1,1,120) do (
    timeout /t 1 /nobreak >nul
    curl -s http://localhost:7000/health >nul 2>&1
    if not errorlevel 1 (
        set REMBG_READY=1
        goto rembg_ready
    )
    if %%i==120 goto rembg_ready
)
:rembg_ready
if %REMBG_READY%==1 (
    echo  Rembg 已就绪
) else (
    echo  Rembg 启动超时（可能在后台继续加载，稍后可用）
)

echo.
echo [3/6] 启动投屏主服务 (端口 3000)...
start "Screen (3000)" /min "%~dp0start-screen.bat"
timeout /t 3 /nobreak >nul

echo.
echo [4/6] 启动收件箱监听 (B电脑监控)...
if exist "%~dp0..\收件箱监听\inbox-watcher.js" (
    start "Inbox Watcher" /min "%~dp0start-inbox.bat"
    timeout /t 2 /nobreak >nul
) else (
    echo  [跳过] 未找到收件箱监听项目
)

echo.
echo [5/6] 验证服务状态...
echo  验证 Rembg (7000)...
curl -s http://localhost:7000/health >nul 2>&1 && echo    Rembg: 运行中 || echo    Rembg: 尚未就绪
echo  验证 Screen (3000)...
curl -s http://localhost:3000/api/artworks >nul 2>&1 && echo    投屏系统: 运行中 || echo    投屏系统: 尚未就绪

echo.
echo [6/6] 启动完成！
echo.
echo ==============================================
echo    全部服务已启动！
echo ==============================================
echo.
echo    后台管理:  http://localhost:3000/admin
echo    大屏展示:  http://localhost:3000/display
echo    数据看板:  http://localhost:3000/dashboard
echo.
echo    Rembg:       端口 7000
echo    收件箱监听:  监控 B/C 电脑
echo.
echo    3个最小化窗口在后台运行。
echo    关闭本窗口不影响服务运行。
echo.
echo ==============================================
echo.
pause