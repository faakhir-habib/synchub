# SyncHub Agent — OS service templates

**Recommended:** run `synchub-agent install` (from wherever you placed the
SEA binary — see `apps/agent/install/`). It auto-detects your OS and
registers the right background service for you:

| Platform | Mechanism | Command |
|---|---|---|
| Linux | systemd (per-user) | `synchub-agent install` |
| macOS | launchd (LaunchAgent) | `synchub-agent install` |
| Windows | Scheduled Task (SYSTEM, at boot) | `synchub-agent install` (elevated) |

The files in this directory are the **canonical, checked-in templates** that
`install` mirrors at runtime (see `apps/agent/src/service.ts`) — they exist
for manual or custom setups (e.g. a system-wide Linux install running as a
dedicated user, rather than the per-user default `install` registers).
Every template runs the packaged SEA binary directly (never `node`) and
reads its config from `SYNCHUB_CONFIG`.

- `systemd/synchub-agent.service` — Linux. See the header comment in the
  file for both the system-wide (`/etc/systemd/system`, dedicated `synchub`
  user) and per-user (`~/.config/systemd/user/`) install paths.
- `launchd/cloud.mylogiclab.synchub-agent.plist` — macOS. See the header
  comment for the manual per-user LaunchAgent install path.
- `windows/README.md` — Windows. No static file to copy (the mechanism is a
  generated Scheduled Task, not a config file); documents the exact command
  `install` runs, plus a `sc.exe`/WinSW follow-up for a true SCM service.

Whichever path you use, the SEA binary must actually exist at the path the
template references — adjust `ExecStart` / `ProgramArguments` /
`schtasks /TR` to your real install location if you didn't use
`apps/agent/install/install.sh` or `install.ps1` (which default to
`/usr/local/bin/synchub-agent` and
`%LOCALAPPDATA%\Programs\SyncHub\synchub-agent.exe` respectively).

## Cheatsheet

| Action | Linux (systemd --user) | macOS (launchd) | Windows (Scheduled Task) |
|---|---|---|---|
| Install/enable | `systemctl --user enable --now synchub-agent` | `launchctl load -w ~/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist` | `schtasks /Create /TN SyncHubAgent ...` (see `windows/README.md`) |
| Status | `systemctl --user status synchub-agent` | `launchctl list \| grep cloud.mylogiclab.synchub-agent` | `schtasks /Query /TN SyncHubAgent` |
| Disable/remove | `systemctl --user disable --now synchub-agent` | `launchctl unload -w ~/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist` | `schtasks /Delete /TN SyncHubAgent /F` |
| Logs | `journalctl --user -u synchub-agent` | `/tmp/synchub-agent.log` / `.err` | Event Viewer (Task Scheduler history) |

`synchub-agent status` also reports service state directly (installed /
running) alongside pairing state, on all three platforms.
