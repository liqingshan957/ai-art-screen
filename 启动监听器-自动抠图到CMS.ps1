$host.UI.RawUI.WindowTitle = "监听器-自动抠图到CMS"
$ScriptDir = $PSScriptRoot
$scriptStart = Get-Date

function Write-Step { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }
function Write-OK { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail { param([string]$msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Write-Skip { param([string]$msg) Write-Host "  [..] $msg" -ForegroundColor DarkGray }
function Get-Elapsed { return [math]::Round(((Get-Date) - $scriptStart).TotalSeconds, 1) }

$configPath = Join-Path $ScriptDir "scripts\local-cutout-config.json"

# ---- 首次使用引导 ----
if (-not (Test-Path $configPath)) {
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "   首次使用需要配置" -ForegroundColor White
    Write-Host "   请按提示输入 CMS 配置信息..." -ForegroundColor Gray
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host ""

    $setupScript = Join-Path $ScriptDir "scripts\setup-config.js"
    & node $setupScript
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "配置未完成($LASTEXITCODE)，已退出 ($(Get-Elapsed)s)"
        Read-Host "按 Enter 关闭"
        exit 1
    }
    if (-not (Test-Path $configPath)) {
        Write-Fail "配置已取消，已退出 ($(Get-Elapsed)s)"
        Read-Host "按 Enter 关闭"
        exit 1
    }
    Write-Host ""
}

# ---- 启动服务 ----
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    CMS 自动抠图" -ForegroundColor White
Write-Host "    Rembg(7000) + Worker(轮询 CMS 抠图)" -ForegroundColor Gray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 清除 Rembg 端口
Write-Step "[1/2] 启动 Rembg 抠图服务..."
try {
    try {
        Get-NetTCPConnection -LocalPort 7000 -ErrorAction Stop | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-OK "端口 7000 已释放 ($(Get-Elapsed)s)"
        }
    } catch { Write-Skip "端口 7000 未被占用" }
} catch {}

$rembgPs1 = Join-Path $ScriptDir "启动Rembg抠图服务.ps1"
$rembgJob = Start-Process -WindowStyle Minimized -FilePath "powershell" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rembgPs1`""
Start-Sleep -Seconds 5

# ---- 启动工作脚本 ----
Write-Host ""; Write-Step "[2/2] 启动抠图工作脚本 ($(Get-Elapsed)s)..."
Write-Host "   轮询 CMS 下载 -> 下载原图 -> Rembg 抠图 -> 上传回 CMS" -ForegroundColor Gray
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   工作脚本在前台运行  (总耗时: $(Get-Elapsed)s)" -ForegroundColor White
Write-Host "   按 Ctrl+C 可停止" -ForegroundColor DarkGray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

$worker = Join-Path $ScriptDir "scripts\local-cutout-worker.js"
Set-Location $ScriptDir
node $worker

Write-Host ""; Write-Host "抠图服务已停止" -ForegroundColor Red
Read-Host "按 Enter 关闭"
