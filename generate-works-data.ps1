# 生成作品展示页数据 - 只收录有裁剪图的在架+归档作品
$src = Join-Path $PSScriptRoot "data\artworks.json"
$origDir = Join-Path $PSScriptRoot "public\uploads\originals"
$data = Get-Content $src -Raw -Encoding UTF8 | ConvertFrom-Json
$result = foreach($a in $data) {
    if(-not (Test-Path (Join-Path $origDir "$($a.id)_c.png"))) { continue }
    $d = $a.date
    [PSCustomObject]@{
        id = $a.id; name = $a.name; date = $d
        url = "/uploads/originals/$($a.id)_c.png"
        status = $a.status; isActive = ($a.status -eq 'active')
    }
} | Sort-Object date, name -Descending
$json = $result | ConvertTo-Json -Compress
$json | Out-File (Join-Path $PSScriptRoot "public\works-data.json") -Encoding utf8
$json | Out-File (Join-Path $PSScriptRoot "deploy-pagefire\works-data.json") -Encoding utf8
Write-Host "✅ Generated $($result.Count) artworks" -ForegroundColor Green
