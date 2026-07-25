@echo off
cd /d "D:\Linn Workspace\02-项目总览\大象智绘AI科创\广州美术馆展览\投屏系统"
title Screen System (port 3000)
echo Screen system starting...
D:\Git\node\node.exe server.js
echo.
echo Service stopped. Press any key to close...
pause >nul
