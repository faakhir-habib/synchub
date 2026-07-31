# SyncHub Agent

Headless per-machine watcher that keeps a project's Claude Code session
transcripts (`~/.claude/projects/<hash>/*.jsonl`) in sync with the Hub.

## Requirements

Node 22+ (developed on Node 24). No native build step.

```
npm install
```

## 1. Pair this machine

In the Hub UI → **Machines → Connect machine**, copy the 6-character code, then:

```
node src/cli.js pair ABC123 https://synchub.mylogiclab.cloud
```

This redeems the code, receives a machine token, and writes
`~/.synchub/config.json` (chmod 600). Then map this machine to a project and its
local `~/.claude/projects/<hash>` folder in the Hub UI (Project → Add machine).

## 2. Run

```
node src/cli.js run        # or: npm start
```

On start it **reconciles** every mapped project (pulls Hub-newer transcripts,
pushes local ones), then watches for changes and connects the live relay:
- local `*.jsonl` change → debounced push (auto mode);
- Hub `changed` event → pull that transcript;
- Hub `sync` event (manual "Sync now") → reconcile that project.

Conflicts that can't be auto-merged are surfaced in the Hub UI for you to resolve.

## Run as a background service

- **Linux (systemd):** copy `service/systemd/synchub-agent.service` to
  `~/.config/systemd/user/`, adjust paths, then
  `systemctl --user enable --now synchub-agent`.
- **macOS (launchd):** copy `service/launchd/cloud.mylogiclab.synchub-agent.plist`
  to `~/Library/LaunchAgents/`, adjust paths, then `launchctl load` it.
- **Windows (Task Scheduler):** run `service/windows/install-service.ps1` in
  PowerShell (registers a logon task with auto-restart).

## Config & state

| File | Purpose |
|------|---------|
| `~/.synchub/config.json` | hub URL + machine token (secret, chmod 600) |
| `~/.synchub/state.json` | per-file last-known canonical hash (for conflict detection) |

Override locations with `SYNCHUB_CONFIG` / `SYNCHUB_STATE`.
