#requires -version 5.1

<#
.SYNOPSIS
  敦煌 AIGC 艺术展 · 投屏系统启动脚本（不抠图模式 / 展览现场）
.DESCRIPTION
  清理端口 → 启动 Rembg(7000) → 启动 Node 主服务(3000) → 验证状态
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
    } catch {
        # 端口未被占用
    }
}

Write-Host "======================================================"
Write-Host "   敦煌 AIGC 艺术展 · 投屏系统"
Write-Host "   Rembg(7000) + Node(3000)  [不抠图模式 / 展览现场]"
Write-Host "======================================================"
Write-Host ""

# ---- 1. 释放端口 ----
Write-Host "[1/4] 释放端口..."
Write-Host ""
Release-Port 3000
Release-Port 7000
Start-Sleep -Seconds 1

# ---- 2. 启动 Rembg ----
Write-Host ""
Write-Host "[2/4] 启动 Rembg 抠图服务..."
Write-Host ""

$rembgPs1 = [System.IO.Path]::Combine($RootDir, "启动Rembg抠图服务.ps1")
Start-Process -WindowStyle Minimized -FilePath "powershell" -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-NoProfile", "-File", "`"$rembgPs1`""
)

Write-Host "  ...等待 Rembg 加载模型，首次约 1-2 分钟"

$rembgReady = $false
for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 1
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadString("http://localhost:7000/api/health") | Out-Null
        $rembgReady = $true
        break
    } catch {
        # 尚未就绪，继续等待
    }
}

if ($rembgReady) {
    Write-Host "  [OK] Rembg 抠图服务已经就绪"
} else {
    Write-Host "  [..] Rembg 未就绪，后台继续加载中，不影响首次连接"
}

# ---- 3. 启动 Node 主服务 ----
Write-Host ""
Write-Host "[3/4] 启动投屏服务..."
Write-Host ""

$nodeJob = Start-Process -WindowStyle Minimized -FilePath "node" -ArgumentList @("server.js") -PassThru

Start-Sleep -Seconds 3

# ---- 4. 验证状态 ----
Write-Host "[4/4] 验证服务状态..."
Write-Host ""

$svrOk = $false
$rembgOk = $false

try {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadString("http://localhost:3000/api/artworks") | Out-Null
    $svrOk = $true
} catch { }

try {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadString("http://localhost:7000/api/health") | Out-Null
    $rembgOk = $true
} catch { }

if ($svrOk)    { Write-Host "  [OK] 投屏服务(3000):  运行中" } else { Write-Host "  [XX] 投屏服务(3000):  未响应" }
if ($rembgOk)  { Write-Host "  [OK] Rembg(7000):     运行中" } else { Write-Host "  [XX] Rembg(7000):     未响应" }

Write-Host ""
Write-Host "======================================================"
Write-Host "  全部服务已启动"
Write-Host ""
Write-Host "   展览展示  http://localhost:3000/display"
Write-Host "   画廊首页  http://localhost:3000/gallery"
Write-Host "   管理后台  http://localhost:3000/admin"
Write-Host "   运营看板  http://localhost:3000/dashboard"
Write-Host ""
Write-Host "  窗口在后台运行，关闭本窗口不影响"
Write-Host "======================================================"
Write-Host ""

pause
