# Windows service — reference

Windows has no checked-in template file (unlike systemd/launchd) because the
primary approach is a generated Scheduled Task, not a static config file you
copy into place. This page documents exactly what `synchub-agent install`
does, and the manual follow-up for a "true" SCM service.

## Primary approach: `synchub-agent install` (Scheduled Task at startup)

From an **elevated (Administrator) PowerShell**:

```powershell
synchub-agent install
```

This registers a Scheduled Task named `SyncHubAgent` that starts **at boot**
(`/SC ONSTART`), running as `SYSTEM` in Session 0 — a genuine
background-service-like start, not a per-logon task tied to a specific user
being signed in. It bakes the paired machine's `SYNCHUB_CONFIG` path directly
into the task (SYSTEM's own environment has no knowledge of your user
profile, so the config path can't be inherited — see the comment on
`windowsTaskRunCommand` in `apps/agent/src/service.ts` for the full
rationale).

The exact command `install` runs (shown here for transparency — you normally
never need to type this yourself):

```powershell
schtasks /Create /TN SyncHubAgent /TR "cmd /c set ""SYNCHUB_CONFIG=<configPath>"" && ""<selfPath>"" run" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
```

Where `<selfPath>` is the full path to the SEA binary that is currently
running `install` (`process.execPath`, i.e. wherever you placed
`synchub-agent.exe`), and `<configPath>` is the path to the paired
`config.json` (defaults to `%USERPROFILE%\.synchub\config.json`, or whatever
`SYNCHUB_CONFIG` was set to at pair time). `/TR` is passed as a single
argument (no shell), so schtasks stores the whole `cmd /c set "..." &&
"..." run` string opaquely; at trigger time Task Scheduler resolves `cmd` via
PATH and hands it the rest verbatim, and it's cmd.exe itself that parses the
`set` + `&&` at that point.

Check / manage it directly:

```powershell
schtasks /Query /TN SyncHubAgent
synchub-agent status          # also reports paired/not-paired state
synchub-agent uninstall       # schtasks /Delete /TN SyncHubAgent /F
```

## Follow-up: a true SCM service (`sc.exe` / WinSW)

A plain SEA `.exe` does not speak the Windows Service Control Manager
protocol (it doesn't call `StartServiceCtrlDispatcher`), so registering it
directly with `sc.exe create` produces a service that Windows marks as "not
responding" the moment SCM tries to start it and gets no handshake back.

To get a real SCM service (full `Start-Service`/`Stop-Service`,
`Restart=on-failure`-style SCM recovery actions, service dependencies, event
log integration, etc.), wrap the binary with
[WinSW](https://github.com/winsw/winsw) — a small executable that *does*
speak the SCM protocol and launches your binary as its child process:

```powershell
# 1. Download WinSW and place it next to the agent binary as SyncHubAgent.exe
#    (rename the downloaded WinSW-x64.exe), plus a SyncHubAgent.xml config:

# SyncHubAgent.xml
# <service>
#   <id>SyncHubAgent</id>
#   <name>SyncHub Agent</name>
#   <description>Keeps Claude Code transcripts in sync with the Hub.</description>
#   <executable>C:\opt\synchub\synchub-agent.exe</executable>
#   <arguments>run</arguments>
#   <env name="SYNCHUB_CONFIG" value="C:\ProgramData\synchub\config.json"/>
#   <onfailure action="restart" delay="5 sec"/>
# </service>

# 2. Install and start the service:
C:\opt\synchub\SyncHubAgent.exe install
sc.exe start SyncHubAgent

# 3. Manage it like any other Windows service:
sc.exe query SyncHubAgent
sc.exe stop SyncHubAgent
C:\opt\synchub\SyncHubAgent.exe uninstall
```

**Tradeoff:** the Scheduled Task approach above has no extra dependency and
is what `synchub-agent install` automates, but it lacks full SCM restart
semantics (SCM-native crash recovery policies, `Stop-Service` graceful-stop
signaling, service dependency ordering). WinSW closes that gap at the cost of
an extra bundled executable and a manual XML config — treat it as an opt-in
follow-up for deployments that specifically need SCM semantics, not the
default path.
