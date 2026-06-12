$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$electronDist = Join-Path $root "node_modules\electron\dist"
$rendererDist = Join-Path $root "roku-dist"
$outputRoot = Join-Path $root "release"
$appName = "Roku WASD Remote"
$sourcePackage = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$portableDir = Join-Path $outputRoot "Roku-WASD-Remote-v$($sourcePackage.version)-win32-x64"
$appDir = Join-Path $portableDir "resources\app"

function Assert-InRoot($PathToCheck) {
  $resolved = if (Test-Path -LiteralPath $PathToCheck) {
    (Resolve-Path -LiteralPath $PathToCheck).Path
  } else {
    [System.IO.Path]::GetFullPath($PathToCheck)
  }

  if (-not $resolved.StartsWith($root.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside workspace: $resolved"
  }
}

npm run roku:build

node -e "require('electron')"

if (-not (Test-Path -LiteralPath (Join-Path $electronDist "electron.exe"))) {
  throw "Electron runtime is missing. Run npm install first."
}

Assert-InRoot $portableDir
if (Test-Path -LiteralPath $portableDir) {
  Remove-Item -LiteralPath $portableDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
Copy-Item -LiteralPath $electronDist -Destination $portableDir -Recurse -Force
Rename-Item -LiteralPath (Join-Path $portableDir "electron.exe") -NewName "$appName.exe"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item -LiteralPath (Join-Path $root "electron") -Destination (Join-Path $appDir "electron") -Recurse -Force
Copy-Item -LiteralPath $rendererDist -Destination (Join-Path $appDir "roku-dist") -Recurse -Force

$runtimePackage = [ordered]@{
  name = "roku-wasd-remote"
  version = $sourcePackage.version
  productName = $appName
  main = "electron/roku-main.cjs"
  type = "commonjs"
}

$runtimePackage |
  ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $appDir "package.json") -Encoding UTF8

Write-Host "Built $portableDir"
Write-Host "Run $portableDir\$appName.exe"
