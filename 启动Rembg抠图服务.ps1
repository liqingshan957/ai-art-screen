$host.UI.RawUI.WindowTitle = "Rembg 抠图服务 (7000)"
$env:U2NET_HOME = Join-Path $PSScriptRoot "services\rembg\model_cache"
$logDir = Join-Path $PSScriptRoot "logs"
$scriptPath = Join-Path $PSScriptRoot "services\rembg\rembg-server.py"
$logFile = Join-Path $logDir "rembg.log"
$startTime = Get-Date

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir -Force | Out-Null }

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    Rembg Python 抠图服务" -ForegroundColor White
Write-Host "    端口: 7000  模型: u2net" -ForegroundColor Gray
Write-Host "    日志: $logFile" -ForegroundColor Gray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

Add-Content $logFile "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] ===== Rembg 服务启动 ====="

Write-Host "  [..] 启动中... http://localhost:7000" -ForegroundColor Yellow
Write-Host ""
Write-Host "  按 Ctrl+C 停止，将自动重启" -ForegroundColor DarkGray
Write-Host ""

$restartCount = 0
while ($true) {
    Add-Content $logFile "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] 启动中..."

    & python $scriptPath 2>&1 | ForEach-Object {
        Add-Content $logFile $_
        $uptime = [math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)
        Write-Host "$_  [运行 ${uptime}m]"
    }

    $restartCount++
    $uptime = [math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)
    Write-Host "  [!!] 进程异常退出！$(Get-Date -Format 'HH:mm:ss')  3 秒后重启... (重启#$restartCount, 总运行 ${uptime}m)" -ForegroundColor Red
    Add-Content $logFile "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] 异常退出(#$restartCount)，重启中..."
    Start-Sleep -Seconds 3
    Write-Host "  [..] 重启中..." -ForegroundColor Yellow
}
