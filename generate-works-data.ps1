$src = Join-Path $PSScriptRoot "data\artworks.json"
$origDir = Join-Path $PSScriptRoot "public\uploads\originals"
$data = Get-Content $src -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @()
foreach($a in $data) {
    $cropFile = Join-Path $origDir "$($a.id)_c.png"
    if(Test-Path $cropFile) {
        $result += [PSCustomObject]@{
            id = $a.id; name = $a.name; date = $a.date
            url = "/uploads/originals/$($a.id)_c.png"
            status = $a.status; isActive = ($a.status -eq 'active')
        }
    }
}
$result = $result | Sort-Object date, name -Descending
$json = $result | ConvertTo-Json -Compress
$j1 = Join-Path $PSScriptRoot "public\works-data.json"
$j2 = Join-Path $PSScriptRoot "deploy-pagefire\works-data.json"
$json | Out-File $j1 -Encoding utf8
$json | Out-File $j2 -Encoding utf8
Write-Host "Generated $($result.Count) artworks" -ForegroundColor Green
