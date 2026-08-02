# Registers the SyncHub Agent to run at logon via Windows Task Scheduler.
# Run in PowerShell from the agent/ directory after `synchub-agent pair ...`.
param(
  [string]$NodeExe = (Get-Command node).Source,
  [string]$AgentCli = (Join-Path $PSScriptRoot "..\..\src\cli.js" | Resolve-Path).Path,
  [string]$TaskName = "SyncHubAgent"
)

$action  = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$AgentCli`" run"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "Registered scheduled task '$TaskName'. Start now with: Start-ScheduledTask -TaskName $TaskName"
