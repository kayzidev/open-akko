param(
  [ValidateSet('setup', 'msi', 'both', 'portable')]
  [string]$Format = 'setup'
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$App = Join-Path $Root 'app'
$Target = 'x86_64-pc-windows-msvc'
$Artifacts = Join-Path $Root 'artifacts/windows'
New-Item -ItemType Directory -Force -Path $Artifacts | Out-Null
Push-Location $App
try {
  if (-not (Test-Path 'node_modules')) {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  }
  $Arguments = @('run', 'tauri', '--', 'build', '--ci', '--config', 'src-tauri/tauri.windows.conf.json', '--target', $Target)
  switch ($Format) {
    'setup' { $Arguments += @('--bundles', 'nsis') }
    'msi' { $Arguments += @('--bundles', 'msi') }
    'both' { $Arguments += @('--bundles', 'nsis,msi') }
    'portable' { $Arguments += '--no-bundle' }
  }
  $Arguments += @('--', '--locked')
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'The Windows build failed.' }
  $TargetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $App 'src-tauri/target' }
  $Release = Join-Path $TargetRoot "$Target/release"
  if ($Format -ne 'portable') {
    $Bundles = Get-ChildItem -LiteralPath (Join-Path $Release 'bundle') -Recurse -File |
      Where-Object { ($Format -in @('setup', 'both') -and $_.Name -like '*setup.exe') -or ($Format -in @('msi', 'both') -and $_.Extension -eq '.msi') }
    if (-not $Bundles) { throw 'No requested installer was produced.' }
    $Bundles | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Artifacts -Force }
  }
  $Portable = Join-Path $Artifacts 'Open-Akko-portable'
  New-Item -ItemType Directory -Force -Path $Portable | Out-Null
  Copy-Item -LiteralPath (Join-Path $Release 'sharkfin.exe') -Destination (Join-Path $Portable 'Open Akko.exe') -Force
  foreach ($File in @('LICENSE', 'THIRD-PARTY-NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $App "dist/$File") -Destination $Portable -Force
  }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PORTABLE.md') -Destination (Join-Path $Portable 'README.md') -Force
  Compress-Archive -Path (Join-Path $Portable '*') -DestinationPath (Join-Path $Artifacts 'Open-Akko-windows-x64-portable.zip') -Force
  Get-ChildItem -LiteralPath $Artifacts -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | ForEach-Object {
    (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $_.Name
  } | Set-Content -LiteralPath (Join-Path $Artifacts 'SHA256SUMS.txt') -Encoding ascii
  Write-Output "Windows packages: $Artifacts"
} finally { Pop-Location }
