$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js 22 이상을 설치한 뒤 다시 실행해 주세요. https://nodejs.org/'; Read-Host 'Enter'; exit 1 }
if ((-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\cheerio'))) -or (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\leaflet'))) -or (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\leaflet.markercluster')))) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { Read-Host '설치 실패. Enter'; exit 1 } }
$portValue = if ($env:PORT) { $env:PORT } else { '4327' }
$envPath = Join-Path $PSScriptRoot '.env'
if ((-not $env:PORT) -and (Test-Path -LiteralPath $envPath)) { foreach ($line in (Get-Content -LiteralPath $envPath)) { if ($line -match '^PORT=(\d+)$') { $portValue = $Matches[1] } } }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Read-Host '빌드 실패. Enter'; exit 1 }
Start-Process "http://localhost:$portValue"
& node scripts/preview.mjs
