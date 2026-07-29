#requires -version 5.1

<#
.SYNOPSIS
  敦煌 AIGC 艺术展 · 自动投屏系统启动脚本（本地开发）
.DESCRIPTION
  清理端口 → 启动 Rembg(7000) → 启动 Node 主服务(3000)（自动抠图模式）
#>

$ErrorActionPreference = "Continue"
$script:RootDir = $PSScriptRoot
Set-Location $RootDir

# 辅助函数：释放端口
function Release-Port($Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop
        if ($conn.OwningProcess -gt 0) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "  [OK] 端口 $Port 已释放"
        }
    } catch { }
}

Write-Host "======================================================"
Write-Host "   敦煌 AIGC 艺术展 · 自动投屏系统"
Write-Host "   Rembg(7000) + Node(3000)  [自动抠图模式]"
Write-Host "======================================================"
Write-Host ""

# ---- 1. 释放端口 ----
Write-Host "[1/3] 释放端口..."
Write-Host ""
Release-Port 3000
Release-Port 7000
Start-Sleep -Seconds 1

# ---- 2. 启动 Rembg ----
Write-Host ""
Write-Host "[2/3] 启动 Rembg 抠图服务..."
Write-Host ""

$rembgPs1 = [System.IO.Path]::Combine($RootDir, "启动Rembg抠图服务.ps1")
Start-Process -WindowStyle Minimized -FilePath "powershell" -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-NoProfile", "-File", "`"$rembgPs1`""
)

$rembgReady = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadString("http://localhost:7000/api/health") | Out-Null
        $rembgReady = $true
        break
    } catch { }
}

if ($rembgReady) {
    Write-Host "  [OK] Rembg 抠图服务已经就绪 (http://localhost:7000)"
} else {
    Write-Host "  [..] Rembg 未就绪，后台继续加载中"
}

# ---- 3. 启动 Node 主服务（自动抠图模式，前台运行） ----
Write-Host ""
Write-Host "[3/3] 启动主服务..."
Write-Host ""
Write-Host "======================================================"
Write-Host "  全部服务已启动"
Write-Host ""
Write-Host "   展览展示  http://localhost:3000/display"
Write-Host "   画廊首页  http://localhost:3000/gallery"
Write-Host "   管理后台  http://localhost:3000/admin"
Write-Host "   运营看板  http://localhost:3000/dashboard"
Write-Host "   Rembg     http://localhost:7000"
Write-Host ""
Write-Host "  Ctrl+C 停止服务"
Write-Host "======================================================"
Write-Host ""

$env:ENABLE_AUTO_CUTOUT = "true"
& node server.js

Write-Host ""
Write-Host "服务已停止"
pause
