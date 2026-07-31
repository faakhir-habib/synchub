# SyncHub Hub

Always-on relay + web UI for syncing Claude Code session transcripts.

## Run

```
npm install
npm start            # http://localhost:8080  (PORT to override)
```

DB is created at `data/synchub.sqlite` on first run (`DB_PATH` to override).
Uses Node's built-in `node:sqlite` — **no native build step required**
(needs Node 22+; developed on Node 24).

## Test

```
npm test             # node:test, in-memory SQLite, real HTTP surface
```

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `data/synchub.sqlite` | SQLite file (`:memory:` in tests) |

## Status

**Phase 1 (Hub core) complete:** auth (signup/login/logout/me/webhook),
machines CRUD + pairing codes, projects CRUD + sync-mode, mappings CRUD,
per-user isolation, and the redesign UI shell wired to auth.

Next phases: sync protocol (agent push/pull/manifest) → conflicts →
WebSocket relay → metrics & notifications → the Agent → native
notifications. See `../docs/superpowers/plans/`.
