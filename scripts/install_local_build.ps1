$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildPath = if ($env:CANCAN_BUILD_PATH) { $env:CANCAN_BUILD_PATH } else { Join-Path $RepoRoot 'cancan.exe' }
$InstallDir = if ($env:CANCAN_INSTALL_DIR) { $env:CANCAN_INSTALL_DIR } else { Join-Path $HOME '.local\bin' }
$InstallPath = Join-Path $InstallDir 'cancan.exe'

if (-not (Test-Path -LiteralPath $BuildPath)) {
    throw "Built executable not found at $BuildPath. Run scripts\\build.bat first or set CANCAN_BUILD_PATH."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -LiteralPath $BuildPath -Destination $InstallPath -Force

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @()
if ($userPath) {
    $pathEntries = $userPath -split ';' | Where-Object { $_ }
}

if ($pathEntries -notcontains $InstallDir) {
    $newPath = if ($userPath) { "$InstallDir;$userPath" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Added $InstallDir to your user PATH. Open a new terminal if needed."
}

Write-Host "Installed local build to $InstallPath"
