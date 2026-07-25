@echo off
cd /d "D:\桌面\开发项目\收件箱监听"
title Inbox Watcher
echo Inbox watcher starting...
node inbox-watcher.js
echo.
echo Stopped. Press any key to close...
pause >nul
