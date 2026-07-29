@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动监听器-自动抠图到CMS.ps1"
pause
