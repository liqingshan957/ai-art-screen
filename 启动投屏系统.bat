@echo off
cd /d "%~dp0"

echo ==============================================
echo    Dunhuang AIGC Exhibition - Screen System
echo    (Dunhuang AIGC Art Exhibition - Screen Cast)
echo ==============================================
echo.
echo [1/5] Cleaning existing processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

echo.
echo [2/5] Starting Rembg (port 7000) - Background Removal...
start "Rembg (7000)" /min "%~dp0start-rembg.bat"
timeout /t 12 /nobreak >nul

echo.
echo [3/5] Starting Screen System (port 3000) - Main Server...
start "Screen (3000)" /min "%~dp0start-screen.bat"
timeout /t 3 /nobreak >nul

echo.
echo [4/5] Starting Inbox Watcher - B Computer Image Monitor...
start "Inbox Watcher" /min "%~dp0start-inbox.bat"
timeout /t 2 /nobreak >nul

echo.
echo ==============================================
echo    All 3 services started successfully!
echo ==============================================
echo.
echo    Admin Panel:  http://localhost:3000/admin
echo    Display:      http://localhost:3000/display
echo    Dashboard:    http://localhost:3000/dashboard
echo.
echo    Rembg:       Running (port 7000)
echo    Inbox Watch: Running (B computer)
echo.
echo    3 minimized windows are running in background.
echo    Close this window anytime (services keep running).
echo.
echo ==============================================
echo.
pause
