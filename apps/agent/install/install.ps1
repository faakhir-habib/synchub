<#
.SYNOPSIS
  SyncHub Agent one-line installer (Windows).

.DESCRIPTION
  Intended usage:
    irm https://<host>/install.ps1 | iex
    # or, to pair immediately:
    $env:SYNCHUB_CODE = "ABC123"; $env:SYNCHUB_HUB = "https://synchub.example.com"
    irm https://<host>/install.ps1 | iex

  Downloads the SEA (Single Executable Application) synchub-agent.exe from
  GitHub Releases, installs it under %LOCALAPPDATA%\Programs\SyncHub, and
  adds that directory to the user PATH. Optionally pairs with a Hub.
  Safe to re-run: always overwrites the installed binary (upgrade-in-place).

.PARAMETER Code
  Pairing code (alternative to $env:SYNCHUB_CODE). Piping via `iex` has no
  positional args, so the env-var form is the primary supported path for
  paired installs.

.PARAMETER Hub
  Hub URL (paired with -Code / $env:SYNCHUB_HUB / $env:SYNCHUB_CODE).

.PARAMETER Help
  Show help and exit.
#>
param(
  [string]$Code = $null,
  [string]$Hub = $null,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  Write-Host "[install] $Message"
}

function Write-ErrLog([string]$Message) {
  Write-Host "[install] error: $Message" -ForegroundColor Red
}

if ($Help) {
  @"
SyncHub Agent installer

Usage:
  install.ps1 [-Code <CODE>] [-Hub <HUB_URL>]
  irm <url>/install.ps1 | iex

Environment variables:
  SYNCHUB_VERSION   Release tag to install (default: latest)
  SYNCHUB_CODE      Pairing code (used when -Code is not given)
  SYNCHUB_HUB       Hub URL (used when -Hub is not given)
  SYNCHUB_REPO      GitHub "owner/repo" to install from (default: faakhir-habib/synchub)

Options:
  -Help             Show this help and exit

Downloads synchub-agent.exe for your architecture from GitHub Releases,
installs it to `$env:LOCALAPPDATA\Programs\SyncHub\synchub-agent.exe`, and
adds that directory to your user PATH. Re-running upgrades the binary in
place. `synchub-agent install` (which registers the background Scheduled
Task) needs an elevated (Administrator) PowerShell - this installer itself
does not require elevation.
"@ | Write-Host
  exit 0
}

# --- 1. Detect arch, map to the release asset name --------------------------

$archRaw = $env:PROCESSOR_ARCHITECTURE
switch ($archRaw) {
  "AMD64" { $Arch = "x64" }
  "ARM64" { $Arch = "arm64" }
  default {
    Write-ErrLog "unsupported architecture: $archRaw"
    exit 1
  }
}

if ($env:SYNCHUB_REPO) {
  $Repo = $env:SYNCHUB_REPO
} else {
  $Repo = "faakhir-habib/synchub"
}

if ($env:SYNCHUB_VERSION) {
  $Version = $env:SYNCHUB_VERSION
} else {
  $Version = "latest"
}

$Asset = "synchub-agent-win-$Arch.exe"

if ($Version -eq "latest") {
  $DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Asset"
} else {
  $DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$Asset"
}

Write-Log "detected win/$Arch -> $Asset"
Write-Log "downloading $DownloadUrl"

# --- 2. Download and install --------------------------------------------------

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\SyncHub"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$InstallPath = Join-Path $InstallDir "synchub-agent.exe"
$TmpPath = "$InstallPath.download"

try {
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpPath -UseBasicParsing
} catch {
  Write-ErrLog "download failed: $($_.Exception.Message)"
  Write-ErrLog "Check that a release exists for $Version with asset $Asset"
  Write-ErrLog "(set `$env:SYNCHUB_VERSION to pin a specific release tag, or `$env:SYNCHUB_REPO to point at a fork)"
  if (Test-Path $TmpPath) { Remove-Item -Force $TmpPath }
  exit 1
}

Move-Item -Force $TmpPath $InstallPath
Write-Log "installed synchub-agent -> $InstallPath"

# --- 3. Add install dir to the user PATH if missing --------------------------

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $userPath) { $userPath = "" }
$pathEntries = $userPath -split ";" | Where-Object { $_ -ne "" }

if ($pathEntries -notcontains $InstallDir) {
  $newUserPath = if ($userPath -and -not $userPath.EndsWith(";")) { "$userPath;$InstallDir" } else { "$userPath$InstallDir" }
  [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
  Write-Log "added $InstallDir to your user PATH (restart your shell to pick it up in new windows)"
} else {
  Write-Log "$InstallDir already on your user PATH"
}

# Make it usable in *this* session too, without waiting for a new shell.
if (($env:Path -split ";") -notcontains $InstallDir) {
  $env:Path = "$env:Path;$InstallDir"
}

# --- 4. Optionally pair, then print next steps --------------------------------

if (-not $Code) { $Code = $env:SYNCHUB_CODE }
if (-not $Hub) { $Hub = $env:SYNCHUB_HUB }

if ($Code -and $Hub) {
  Write-Log "pairing with $Hub ..."
  & $InstallPath pair $Code $Hub
  if ($LASTEXITCODE -eq 0) {
    Write-Log "paired. Register the background service with (elevated PowerShell):"
    Write-Log "  $InstallPath install"
  } else {
    Write-ErrLog "pairing failed - you can retry with: $InstallPath pair <CODE> <HUB_URL>"
    exit 1
  }
} else {
  Write-Log "not paired yet. Next steps:"
  Write-Log "  $InstallPath pair <CODE> <HUB_URL>"
  Write-Log "  $InstallPath install    (run from an elevated/Administrator PowerShell)"
}
