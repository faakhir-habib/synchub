# SyncHub

Self-hosted **Hub** + headless **Agents** that keep [Claude Code](https://claude.com/claude-code)
session transcripts (`~/.claude/projects/<hash>/*.jsonl`) in sync across
any number of machines — independent of Claude account, project path, or OS.

- **Hub** — always-on source of truth (Node + SQLite + WebSocket relay + web UI), deployed on Coolify.
- **Agent** — one per machine; watches mapped folders, pushes/pulls transcripts, resolves conflicts.

See [`docs/superpowers/specs/2026-08-01-synchub-design.md`](docs/superpowers/specs/2026-08-01-synchub-design.md)
for the full design.

## Status

🚧 Under active development — built in phases (Hub core → sync protocol →
conflicts → WebSocket relay → metrics/notifications → Agent → native
notifications).

## Layout

```
hub/     Node/Express Hub (API, relay store, SQLite, web UI)
agent/   Headless per-machine watcher
docs/    Design specs & plans
```
