<#
.SYNOPSIS
  SyncHub Agent one-line uninstaller (Windows).

.DESCRIPTION
  Intended usage:
    irm https://<host>/uninstall.ps1 | iex

  Removes everything the installer (install.ps1) put in place: the
  Scheduled Task background service, the synchub-agent.exe binary + its
  install directory, and the install directory's entry on your user PATH.

  By default this ALSO deletes ~/.synchub (config.json/state.json/
  tombstones.json — your pairing + sync state). Pass -KeepData to leave
  that alone (e.g. you're about to reinstall and want to skip re-pairing).

.PARAMETER KeepData
  Skip deleting ~/.synchub (config/state/tombstones). By default everything
  is removed for a truly clean uninstall.

.PARAMETER Help
  Show help and exit.
#>
param(
  [switch]$KeepData,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  Write-Host "[uninstall] $Message"
}

function Write-ErrLog([string]$Message) {
  Write-Host "[uninstall] error: $Message" -ForegroundColor Red
}

if ($Help) {
  @"
SyncHub Agent uninstaller

Usage:
  uninstall.ps1 [-KeepData]
  irm <url>/uninstall.ps1 | iex

Options:
  -KeepData         Don't delete ~/.synchub (config/state/tombstones)
  -Help             Show this help and exit

Removes the Scheduled Task service, the installed binary, and its user
PATH entry. Run from an elevated (Administrator) PowerShell so the
Scheduled Task can be removed too - without elevation this still cleans up
the binary/PATH but leaves the service registered (rerun elevated after).
"@ | Write-Host
  exit 0
}

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\SyncHub"
$InstallPath = Join-Path $InstallDir "synchub-agent.exe"

# --- 1. Remove the background service ----------------------------------------

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)

if (Test-Path $InstallPath) {
  if ($isAdmin) {
    Write-Log "removing background service ..."
    & $InstallPath uninstall
    if ($LASTEXITCODE -ne 0) {
      Write-ErrLog "service removal exited with code $LASTEXITCODE - continuing with binary cleanup anyway"
    }
  } else {
    Write-Log "not running elevated - skipping service removal."
    Write-Log "the scheduled task (if any) will be left registered; rerun this script from an"
    Write-Log "elevated (Administrator) PowerShell to remove it, or run manually:"
    Write-Log "  schtasks /Delete /TN SyncHubAgent /F"
  }
} else {
  Write-Log "no synchub-agent binary found at $InstallPath - nothing to run 'uninstall' with."
}

# --- 2. Delete the installed binary -------------------------------------------

if (Test-Path $InstallDir) {
  try {
    Remove-Item -Recurse -Force -Path $InstallDir -Confirm:$false
    Write-Log "removed $InstallDir"
  } catch {
    Write-ErrLog "failed to remove $InstallDir : $($_.Exception.Message)"
  }
} else {
  Write-Log "$InstallDir does not exist - nothing to remove."
}

# --- 3. Remove it from the user PATH ------------------------------------------

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -ne $userPath) {
  $pathEntries = $userPath -split ";" | Where-Object { $_ -ne "" -and $_ -ne $InstallDir }
  $newUserPath = $pathEntries -join ";"
  if ($newUserPath -ne $userPath) {
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    Write-Log "removed $InstallDir from your user PATH (restart your shell to pick it up)"
  }
}

# --- 4. Local data ---------------------------------------------------------

$DataDir = Join-Path $env:USERPROFILE ".synchub"
if (-not $KeepData -and (Test-Path $DataDir)) {
  try {
    Remove-Item -Recurse -Force -Path $DataDir -Confirm:$false
    Write-Log "removed $DataDir"
  } catch {
    Write-ErrLog "failed to remove $DataDir : $($_.Exception.Message)"
  }
} elseif ($KeepData) {
  Write-Log "kept $DataDir (-KeepData)"
}

Write-Log "done."
