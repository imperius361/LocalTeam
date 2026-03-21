[CmdletBinding()]
param(
    [string]$ReleaseOutputDirectory = "dist/release/windows"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandUseErrorActionPreference = $true
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..")).Path

$packageJsonPath = Join-Path $repositoryRoot "package.json"
$sidecarBuildScriptPath = Join-Path $repositoryRoot "scripts/build-sidecar-windows.mjs"

if (-not (Test-Path -Path $packageJsonPath -PathType Leaf)) {
    throw "Cannot find package.json at $packageJsonPath. Run this script from the checked-out repository."
}

if (-not (Test-Path -Path $sidecarBuildScriptPath -PathType Leaf)) {
    throw "Cannot find scripts/build-sidecar-windows.mjs at $sidecarBuildScriptPath."
}

if ($env:OS -ne "Windows_NT") {
    throw "This script is Windows-only. Use PowerShell on Windows to build Windows installers."
}

$releaseDirectoryPath = if ([System.IO.Path]::IsPathRooted($ReleaseOutputDirectory)) {
    $ReleaseOutputDirectory
}
else {
    Join-Path $repositoryRoot $ReleaseOutputDirectory
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found in PATH."
}

Push-Location $repositoryRoot
try {
    Write-Host "Running Windows build from: $repositoryRoot"
    & npm run build:sidecar:windows
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build:sidecar:windows failed with exit code $LASTEXITCODE."
    }

    & npm run tauri build -- --config src-tauri/tauri.windows-cross.conf.json
    if ($LASTEXITCODE -ne 0) {
        throw "npm run tauri build failed with exit code $LASTEXITCODE."
    }

    if (Test-Path -Path $releaseDirectoryPath -PathType Container) {
        Remove-Item -Path $releaseDirectoryPath -Recurse -Force
    }
    New-Item -Path $releaseDirectoryPath -ItemType Directory -Force | Out-Null

    $bundleRoots = @(@(
        Join-Path $repositoryRoot "src-tauri/target/x86_64-pc-windows-msvc/release/bundle"
        Join-Path $repositoryRoot "src-tauri/target/release/bundle"
    ) | Where-Object { Test-Path -Path $_ -PathType Container } | Select-Object -Unique)

    if ($bundleRoots.Count -eq 0) {
        throw "No bundle output directory found under src-tauri/target."
    }

    $allowedExtensions = @(
        ".exe"
        ".msi"
        ".msix"
        ".msixbundle"
        ".appx"
        ".appxbundle"
        ".zip"
        ".sig"
    )

    $copiedArtifacts = New-Object System.Collections.Generic.List[string]

    foreach ($bundleRoot in $bundleRoots) {
        $bundleRootPrefix = $bundleRoot.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
        $artifacts = Get-ChildItem -Path $bundleRoot -File -Recurse | Where-Object {
            $allowedExtensions -contains $_.Extension.ToLowerInvariant()
        }

        foreach ($artifact in $artifacts) {
            $relativePath = $artifact.FullName.Substring($bundleRootPrefix.Length)
            $destinationPath = Join-Path $releaseDirectoryPath $relativePath
            $destinationDirectory = Split-Path -Parent $destinationPath

            if (-not (Test-Path -Path $destinationDirectory -PathType Container)) {
                New-Item -Path $destinationDirectory -ItemType Directory -Force | Out-Null
            }

            Copy-Item -Path $artifact.FullName -Destination $destinationPath -Force
            $copiedArtifacts.Add((Resolve-Path -Path $destinationPath).Path)
        }
    }

    $finalArtifacts = @($copiedArtifacts | Sort-Object -Unique)
    if ($finalArtifacts.Count -eq 0) {
        throw "Build completed, but no installer artifacts were found in bundle outputs."
    }

    Write-Host ""
    Write-Host "Release artifacts:"
    foreach ($artifactPath in $finalArtifacts) {
        Write-Host " - $artifactPath"
    }
}
finally {
    Pop-Location
}
