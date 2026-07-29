#requires -version 5.1

<#
.SYNOPSIS
  Rembg Python 抠图服务（带自动重启）
.DESCRIPTION
  启动 Rembg 抠图 HTTP 服务（端口 7000），进程崩溃时自动重启
#>

$ErrorActionPreference = "Continue"
$script:RootDir = $PSScriptRoot
$script:LogDir = [System.IO.Path]::Combine($RootDir, "logs")
$script:LogFile = [System.IO.Path]::Combine($script:LogDir, "rembg.log")
$script:ServerPy = [System.IO.Path]::Combine($RootDir, "services", "rembg", "rembg-server.py")

# 确保日志目录
$null = New-Item -ItemType Directory -Path $script:LogDir -Force -ErrorAction SilentlyContinue

# 设置模型缓存
$env:U2NET_HOME = [System.IO.Path]::Combine($RootDir, "services", "rembg", "model_cache")

Write-Host "======================================================"
Write-Host "   Rembg Python 抠图服务"
Write-Host "   端口: 7000  模型: u2net"
Write-Host "   日志: $script:LogFile"
Write-Host "======================================================"
Write-Host ""
Write-Host "  [..] 启动中... http://localhost:7000"
Write-Host ""
Write-Host "   按 Ctrl+C 停止，将自动重启"
Write-Host ""

Add-Content -Path $script:LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ===== Rembg 服务启动 ====="

do {
    # 使用 Start-Process 运行 Python（输出重定向到日志），等待退出
    $proc = Start-Process -FilePath "python" -ArgumentList @("`"$script:ServerPy`"") -NoNewWindow -RedirectStandardOutput $script:LogFile -RedirectStandardError $script:LogFile -PassThru -Wait
    $exitCode = $proc.ExitCode

    Write-Host "  [!!] 进程异常退出！Exit=$exitCode  $(Get-Date -Format 'HH:mm:ss')  3 秒后重启..."
    Add-Content -Path $script:LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 异常退出 Exit=$exitCode，重启中..."
    Start-Sleep -Seconds 3
    Write-Host "  [..] 重启中..."
} while ($true)
