$host.UI.RawUI.WindowTitle = "敦煌AIGC·自动抠图投屏系统"
$ScriptDir = $PSScriptRoot
$scriptStart = Get-Date

function Write-Step { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }
function Write-OK { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Skip { param([string]$msg) Write-Host "  [..] $msg" -ForegroundColor DarkGray }
function Get-Elapsed { return [math]::Round(((Get-Date) - $scriptStart).TotalSeconds, 1) }

# ---- Banner ----
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    敦煌 AIGC 艺术展 · 自动投屏系统" -ForegroundColor White
Write-Host "    Rembg(7000) + Node(3000)  [自动抠图模式]" -ForegroundColor Gray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 释放端口 ----
Write-Step "[1/3] 释放端口..."
try {
    3000, 7000 | ForEach-Object {
        try {
            $p = $_
            Get-NetTCPConnection -LocalPort $_ -ErrorAction Stop | ForEach-Object {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-OK "端口 $p 已释放 ($(Get-Elapsed)s)"
            }
        } catch { Write-Skip "端口 $_ 未被占用" }
    }
} catch {}
Start-Sleep -Seconds 1

# ---- 2. 启动 Rembg ----
Write-Host ""; Write-Step "[2/3] 启动 Rembg 抠图服务..."
$rembgPs1 = Join-Path $ScriptDir "启动Rembg抠图服务.ps1"
$rembgJob = Start-Process -WindowStyle Minimized -FilePath "powershell" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rembgPs1`""

$rembgReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadString('http://localhost:7000/api/health') | Out-Null
        $rembgReady = $true; break
    } catch {}
}
if ($rembgReady) { Write-OK "Rembg 抠图服务就绪 (http://localhost:7000)  ($(Get-Elapsed)s)" }
else { Write-Skip "Rembg 未就绪，后台继续加载中 ($(Get-Elapsed)s)" }

# ---- 3. 启动 Node（自动抠图模式） ----
Write-Host ""; Write-Step "[3/3] 启动主服务..."
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 全部服务已启动  (总耗时: $(Get-Elapsed)s)" -ForegroundColor White
Write-Host ""
Write-Host "  展览展示  http://localhost:3000/display" -ForegroundColor Cyan
Write-Host "  画廊首页  http://localhost:3000/gallery" -ForegroundColor Cyan
Write-Host "  管理后台  http://localhost:3000/admin" -ForegroundColor Cyan
Write-Host "  运营看板  http://localhost:3000/dashboard" -ForegroundColor Cyan
Write-Host "  Rembg     http://localhost:7000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Ctrl+C 停止服务" -ForegroundColor DarkGray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

$env:ENABLE_AUTO_CUTOUT = "true"
Set-Location $ScriptDir
node server.js

Write-Host ""; Write-Host "服务已停止" -ForegroundColor Red
Read-Host "按 Enter 关闭"
