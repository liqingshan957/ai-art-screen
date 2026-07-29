@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动投屏系统（自动抠图）.ps1"
if %errorlevel% neq 0 pause
