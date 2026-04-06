$ErrorActionPreference = 'Stop'

$Repo = 'lirrensi/cancan'
$Version = if ($env:CANCAN_VERSION) { $env:CANCAN_VERSION } else { 'latest' }
$InstallDir = if ($env:CANCAN_INSTALL_DIR) { $env:CANCAN_INSTALL_DIR } else { Join-Path $HOME '.local\bin' }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'ARM64') {
    $arch = 'AMD64'
}

if ($arch -ne 'AMD64') {
    throw "Unsupported Windows architecture: $arch"
}

$asset = 'cancan_windows_amd64.zip'
if ($Version -eq 'latest') {
    $url = "https://github.com/$Repo/releases/latest/download/$asset"
} else {
    $url = "https://github.com/$Repo/releases/download/$Version/$asset"
}

$tempDir = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
$zipPath = Join-Path $tempDir $asset

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

try {
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
    Copy-Item -Path (Join-Path $tempDir 'cancan.exe') -Destination (Join-Path $InstallDir 'cancan.exe') -Force
}
finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @()
if ($userPath) {
    $pathEntries = $userPath -split ';'
}

if ($pathEntries -notcontains $InstallDir) {
    $newPath = if ($userPath) { "$InstallDir;$userPath" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Added $InstallDir to your user PATH. Open a new terminal if needed."
}

Write-Host "Installed cancan to $(Join-Path $InstallDir 'cancan.exe')"
