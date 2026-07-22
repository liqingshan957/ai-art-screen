@echo off
cd /d "%~dp0"

echo.
echo ==========================================
echo   敦煌AIGC艺术展览 - 投屏展示系统
echo ==========================================
echo.
echo   展示页(电视大屏): http://localhost:3000/display
echo   管理页(后台操作): http://localhost:3000/admin
echo   数据看板:         http://localhost:3000/dashboard
echo.
echo --- 系统运行中，请勿关闭此窗口 ---
echo --- 最小化即可，不影响使用 ---
echo.

echo [1/2] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

echo [2/2] 正在启动服务...
REM [已暂停] 飞书自动同步功能暂时关闭
REM start /min "飞书同步" D:\Git\node\node.exe feishu_sync.js
D:\Git\node\node.exe server.js

echo.
echo 服务已停止。按任意键关闭窗口...
pause >nul
