#requires -version 5.1

<#
.SYNOPSIS
  CMS 自动抠图监听器
.DESCRIPTION
  启动 Rembg(7000) + 本地抠图工作脚本，轮询 CMS 下载原图 → Rembg 抠图 → 上传回 CMS
#>

$ErrorActionPreference = "Continue"
$script:RootDir = $PSScriptRoot
Set-Location $RootDir

$configFile = [System.IO.Path]::Combine($RootDir, "scripts", "local-cutout-config.json")
$setupScript = [System.IO.Path]::Combine($RootDir, "scripts", "setup-config.js")
$workerScript = [System.IO.Path]::Combine($RootDir, "scripts", "local-cutout-worker.js")

# ---- 首次使用引导 ----
if (-not (Test-Path $configFile)) {
    Write-Host "======================================================"
    Write-Host "   首次使用需要配置"
    Write-Host "   请按提示输入 CMS 配置信息..."
    Write-Host "======================================================"
    Write-Host ""
    & node $setupScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[XX] 配置未完成，已退出"
        pause
        exit 1
    }
    if (-not (Test-Path $configFile)) {
        Write-Host "[XX] 配置已取消，已退出"
        pause
        exit 1
    }
    Write-Host ""
}

# ---- 启动服务 ----
Write-Host "======================================================"
Write-Host "   CMS 自动抠图"
Write-Host "   Rembg(7000) + Worker(轮询 CMS 抠图)"
Write-Host "======================================================"
Write-Host ""

# 释放 Rembg 端口
Write-Host "[1/2] 启动 Rembg 抠图服务..."
Write-Host ""
try {
    $conn = Get-NetTCPConnection -LocalPort 7000 -ErrorAction Stop
    if ($conn.OwningProcess -gt 0) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] 端口 7000 已释放"
    }
} catch { }

$rembgPs1 = [System.IO.Path]::Combine($RootDir, "启动Rembg抠图服务.ps1")
Start-Process -WindowStyle Minimized -FilePath "powershell" -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-NoProfile", "-File", "`"$rembgPs1`""
)

Start-Sleep -Seconds 5

# ---- 启动抠图工作脚本 ----
Write-Host ""
Write-Host "[2/2] 启动抠图工作脚本..."
Write-Host ""
Write-Host "  轮询 CMS 下载 -> 下载原图 -> Rembg 抠图 -> 上传回 CMS"
Write-Host ""
Write-Host "======================================================"
Write-Host "  工作脚本在前台运行"
Write-Host "  按 Ctrl+C 可停止"
Write-Host "======================================================"
Write-Host ""

& node $workerScript

Write-Host ""
Write-Host "抠图服务已停止"
pause
