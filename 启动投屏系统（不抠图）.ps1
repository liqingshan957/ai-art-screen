$host.UI.RawUI.WindowTitle = "敦煌AIGC展·投屏系统（不抠图）"
$ScriptDir = $PSScriptRoot
$scriptStart = Get-Date

function Write-Step { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }
function Write-OK { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Skip { param([string]$msg) Write-Host "  [..] $msg" -ForegroundColor DarkGray }
function Write-Fail { param([string]$msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Get-Elapsed { return [math]::Round(((Get-Date) - $scriptStart).TotalSeconds, 1) }

# ---- Banner ----
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    敦煌 AIGC 艺术展 · 投屏系统" -ForegroundColor White
Write-Host "    Rembg(7000) + Node(3000)  [不抠图模式 / 展览现场]" -ForegroundColor Gray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 释放端口 ----
Write-Step "[1/4] 释放端口..."
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
Write-Host ""; Write-Step "[2/4] 启动 Rembg 抠图服务..."
$rembgPs1 = Join-Path $ScriptDir "启动Rembg抠图服务.ps1"
$rembgJob = Start-Process -WindowStyle Minimized -FilePath "powershell" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rembgPs1`""
Write-Skip "等待 Rembg 加载模型，首次约 1-2 分钟"

$rembgReady = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadString('http://localhost:7000/api/health') | Out-Null
        $rembgReady = $true; break
    } catch {}
}
if ($rembgReady) { Write-OK "Rembg 抠图服务已经就绪 ($(Get-Elapsed)s)" }
else { Write-Skip "Rembg 未就绪，后台继续加载中 ($(Get-Elapsed)s)" }

# ---- 3. 启动 Node ----
Write-Host ""; Write-Step "[3/4] 启动投屏服务..."
$nodeJob = Start-Process -WindowStyle Minimized -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ScriptDir
Start-Sleep -Seconds 3

# ---- 4. 验证状态 ----
Write-Host ""; Write-Step "[4/4] 验证服务状态..."
$nodeOk = $false; $rOk = $false
try { $wc = New-Object System.Net.WebClient; $wc.DownloadString('http://localhost:3000/api/artworks') | Out-Null; $nodeOk = $true } catch {}
try { $wc = New-Object System.Net.WebClient; $wc.DownloadString('http://localhost:7000/api/health') | Out-Null; $rOk = $true } catch {}

if ($nodeOk) { Write-OK "投屏服务(3000):  运行中 ($(Get-Elapsed)s)" } else { Write-Fail "投屏服务(3000):  未响应 ($(Get-Elapsed)s)" }
if ($rOk) { Write-OK "Rembg(7000):     运行中 ($(Get-Elapsed)s)" } else { Write-Fail "Rembg(7000):     未响应 ($(Get-Elapsed)s)" }

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 全部服务已启动  (总耗时: $(Get-Elapsed)s)" -ForegroundColor White
Write-Host ""
Write-Host "  展览展示  http://localhost:3000/display" -ForegroundColor Cyan
Write-Host "  画廊首页  http://localhost:3000/gallery" -ForegroundColor Cyan
Write-Host "  管理后台  http://localhost:3000/admin" -ForegroundColor Cyan
Write-Host "  运营看板  http://localhost:3000/dashboard" -ForegroundColor Cyan
Write-Host ""
Write-Host "  窗口在后台运行，关闭本窗口不影响" -ForegroundColor DarkGray
Write-Host "======================================================" -ForegroundColor Cyan

Read-Host "`n按 Enter 退出"
