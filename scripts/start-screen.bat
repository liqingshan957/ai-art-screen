@echo off
cd /d "%~dp0.."
chcp 65001 >nul 2>nul
title Screen System (port 3000)
echo Screen system starting...
node server.js
echo.
echo Service stopped. Press any key to close...
pause >nul