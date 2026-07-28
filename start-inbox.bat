@echo off
cd /d "%~dp0..\收件箱监听"
chcp 65001 >nul 2>nul
title Inbox Watcher
echo Inbox watcher starting...
echo Watching local artwork folder for new images...
node inbox-watcher.js
echo.
echo Stopped. Press any key to close...
pause >nul
