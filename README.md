# SyncHub

Self-hosted **Hub** + headless **Agents** that keep [Claude Code](https://claude.com/claude-code)
session transcripts (`~/.claude/projects/<hash>/*.jsonl`) in sync across
any number of machines — independent of Claude account, project path, or OS.

- **Hub** — always-on source of truth (Node + SQLite + WebSocket relay + web UI), deployed on Coolify.
- **Agent** — one per machine; watches mapped folders, pushes/pulls transcripts, resolves conflicts.

See [`docs/superpowers/specs/2026-08-01-synchub-design.md`](docs/superpowers/specs/2026-08-01-synchub-design.md)
for the full design.

## Status

✅ **All 7 phases implemented** (38 tests passing: 34 hub + 4 agent):

1. Hub core — auth, machines + pairing, projects + sync-mode, mappings
2. Sync protocol — agent manifest/pull/push, relay store, `file_state`
3. Conflicts — append-only auto-merge + manual resolution
4. WebSocket relay — live fan-out, presence, live notifications
5. Metrics & notifications — dashboard metrics, notification center, webhook relay
6. Agent — chokidar watcher, reconcile, live relay, pairing, OS services
7. Native notifications — OS toasts + optional Electron tray

## Quick start

```bash
# Hub
cd hub && npm install && npm start          # http://localhost:8080

# Agent (on each machine, after Machines → Connect machine in the UI)
cd agent && npm install
node src/cli.js pair <CODE> http://<hub-host>:8080
node src/cli.js run
```

## Layout

```
hub/     Node/Express Hub (API, relay store, node:sqlite, web UI)  — no native deps
agent/   Headless per-machine watcher (+ optional electron/ tray)
docs/    Design spec (docs/superpowers/specs) & per-phase plans (docs/superpowers/plans)
```

## Testing

```bash
cd hub && npm test      # 34 tests
cd agent && npm test    # 4 tests (real agent ↔ real hub)
```
