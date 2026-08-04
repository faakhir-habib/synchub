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
  SYNCHUB_TOKEN     GitHub token (Bearer) to download from a PRIVATE repo's releases

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

# --- 2. Download and install --------------------------------------------------

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\SyncHub"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$InstallPath = Join-Path $InstallDir "synchub-agent.exe"
$TmpPath = "$InstallPath.download"

try {
  if ($env:SYNCHUB_TOKEN) {
    # Private repo: the plain releases/.../download URL 404s without auth, so
    # resolve the asset via the API and pull it with a Bearer token.
    $relApiUrl = if ($Version -eq "latest") { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/$Version" }
    $apiHead = @{ Authorization = "Bearer $($env:SYNCHUB_TOKEN)"; "User-Agent" = "synchub-installer"; Accept = "application/vnd.github+json" }
    $rel = Invoke-RestMethod -Uri $relApiUrl -Headers $apiHead
    $assetObj = $rel.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
    if (-not $assetObj) { throw "asset '$Asset' not found in release '$($rel.tag_name)'" }
    Write-Log "downloading (authenticated) $($assetObj.name) from release $($rel.tag_name)"
    $dlHead = @{ Authorization = "Bearer $($env:SYNCHUB_TOKEN)"; "User-Agent" = "synchub-installer"; Accept = "application/octet-stream" }
    Invoke-WebRequest -Uri $assetObj.url -Headers $dlHead -OutFile $TmpPath -UseBasicParsing
  } else {
    Write-Log "downloading $DownloadUrl"
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpPath -UseBasicParsing
  }
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

$paired = $false
if ($Code -and $Hub) {
  Write-Log "pairing with $Hub ..."
  & $InstallPath pair $Code $Hub
  if ($LASTEXITCODE -eq 0) {
    $paired = $true
    Write-Log "paired."
  } else {
    Write-ErrLog "pairing failed - you can retry with: $InstallPath pair <CODE> <HUB_URL>"
    exit 1
  }
}

# --- 5. Auto-register + (re)start the background service when elevated -----
#
# The registered service runs `synchub-agent run --service`, which WAITS for
# pairing (polling for the config) instead of exiting if this machine isn't
# paired yet - so it's safe to install + start it here even before pairing:
# once `pair` runs (from any shell, any time), the already-running service
# picks up the config and starts syncing with no restart/reboot needed. That
# makes `pair` the ONE manual step left after an elevated install.
#
# `install` itself both registers the Scheduled Task AND (re)starts it - see
# installWindows() in src/service.ts - so this is also the upgrade path: if
# you're re-running this installer to update an already-installed agent, the
# binary just got overwritten above, and this call replaces the running
# process with one running the new binary. No separate uninstall, no reboot.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)

if ($isAdmin) {
  try {
    Write-Log "elevated PowerShell detected - registering + (re)starting the background service ..."
    & $InstallPath install
    if ($LASTEXITCODE -ne 0) {
      throw "synchub-agent install exited with code $LASTEXITCODE"
    }
    Write-Log "service installed and running the just-downloaded binary (it waits for pairing if not paired yet)."
    if ($paired) {
      Write-Log "already paired - SyncHub is fully set up, nothing else to do."
    } else {
      Write-Log "ONLY remaining step:"
      Write-Log "  $InstallPath pair <CODE> <HUB_URL>"
      Write-Log "(get <CODE> from the Hub UI -> Machines -> Connect machine)"
    }
  } catch {
    Write-ErrLog "service setup failed: $($_.Exception.Message)"
    Write-ErrLog "the agent binary is installed regardless - retry the service with (elevated PowerShell):"
    Write-ErrLog "  $InstallPath install"
    if (-not $paired) {
      Write-Log "then pair with:"
      Write-Log "  $InstallPath pair <CODE> <HUB_URL>"
    }
  }
} else {
  Write-Log "not running elevated - binary install is complete, but the background service was NOT registered/updated."
  Write-Log "If a service from a previous elevated install is already running, it is still running the OLD binary."
  Write-Log "To install/upgrade the background service, re-run this installer from an elevated (Administrator)"
  Write-Log "PowerShell (or run '$InstallPath install' elevated). Then pair with:"
  Write-Log "  $InstallPath pair <CODE> <HUB_URL>"
  if ($paired) {
    Write-Log "(this machine is already paired - once the service is installed elevated, it will start syncing immediately.)"
  }
}
