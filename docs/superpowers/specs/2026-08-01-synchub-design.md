# SyncHub — Design Spec

**Status:** Approved (2026-08-01) · **Repo:** `faakhir-habib/synchub` (private)

## 1. Problem

Claude Code stores each conversation as a JSONL transcript at
`~/.claude/projects/<hash-of-absolute-project-path>/<session-uuid>.jsonl`.
There is no native way to keep these transcripts in sync across machines.
SyncHub is the missing piece: a self-hosted **Hub** that relays session
files between any number of **Agents** (one per machine), independent of
Claude account, absolute project path, OS, or machine count.

## 2. Architecture

```
                 ┌─────────────────────────┐
                 │           HUB           │  (Coolify, mylogiclab.cloud)
                 │  Auth · SQLite · Relay  │
                 │  REST · WebSocket · UI  │
                 └────────────┬────────────┘
              HTTPS + wss (both directions, Cloudflare Tunnel)
        ┌─────────────────────┼─────────────────────┐
   ┌────▼────┐           ┌────▼────┐           ┌────▼────┐
   │ Agent A │           │ Agent B │           │ Agent N │
   │ Windows │           │  macOS  │           │  Linux  │
   └─────────┘           └─────────┘           └─────────┘
```

- **Hub** — always-on source of truth. Node 22, Express REST,
  `better-sqlite3`, `ws` WebSocket relay, flat-file relay store on disk,
  static web UI (vanilla HTML/CSS/JS, no build step). Behind Cloudflare
  Tunnel → HTTPS + `wss://`.
- **Agent** — headless Node process, one per machine. `chokidar` watches
  each mapped `~/.claude/projects/<hash>/` folder, filtered to `*.jsonl`,
  debounced ~1–2s before push. REST (push/pull/manifest) + WebSocket
  (live relay + heartbeat). Runs as an OS service (Task Scheduler/NSSM,
  launchd, systemd).
- **Phase 7** — agent fires native OS toasts (`node-notifier`); optional
  Electron tray app for persistent status/history.

## 3. Core principles

1. Never touch Claude Code's path-hashing. Move files by **session-UUID
   filename** only — portable, only the parent folder differs per machine.
2. The Hub is the source of truth, not just a pipe. Every pushed file
   lands in persistent relay storage; an offline machine never causes
   data loss.
3. Sync account ≠ Claude account. Each machine authenticates with its own
   Hub-issued machine token.
4. Conflicts are resolved by the user, never silently overwritten.
5. **Per-user isolation.** Each user has their own account; no teams,
   workspaces, roles, or cross-user visibility. "Workspace" appears only
   as a cosmetic UI label.

## 4. Product semantics — reuse the look, retarget the content

The `SyncHub-Redesign/` mockups are the **visual target** (dark theme,
sidebar app-shell, stat cards, tables, machine cards, badges — ship
`theme.css` + `app.js` as-is). Their git/file wording is retargeted to
the transcript domain:

| Mockup wording | SyncHub reality |
|---|---|
| "Import repository", "branch: main", "ignore rules: N patterns" | removed — we only ever watch `*.jsonl` |
| "tracked files: 1,284" | "Sessions: N" (transcript count) |
| "src/server.js differs" | "`<session-uuid>.jsonl` diverged" |
| "Connect machine" (token copy) | **pairing-code flow**: Hub issues a short-lived code, agent redeems it for its machine token |
| machine card IP/version/OS | kept — agent self-reports LAN IP, agent version, OS + label |

## 5. Data model

Base tables (per user, isolated):

| Table | Purpose |
|---|---|
| `users` | email, scrypt password hash/salt, `notify_webhook_url` |
| `sessions` | Hub UI login (bearer) tokens |
| `machines` | name, unique machine token, `os`, `os_version`, `label`, `agent_version`, `last_ip`, `status` (online/sleeping/offline), `last_seen_at` |
| `projects` | alias, `sync_mode` (auto\|manual\|stopped), `created_at` |
| `mappings` | (project, machine) → local folder path |
| `file_state` | canonical current hash per (project, filename), who last wrote it, size, updated_at |
| `conflicts` | open/resolved — filename, machine, candidate hash, `auto_merged` flag |
| `notifications` | per-user, type (conflict\|sync\|info), read/unread |
| `events` | (user, machine, project, type, filename, bytes, latency_ms, created_at) — backs metrics tiles, activity timeline, notification triggers |
| `pairing_codes` | (code, user, machine?, expires_at) — connect-machine onboarding |

## 6. Sync protocol

**Modes (per project):** `auto` (live push/pull over WS), `manual` (stay
connected, reconcile only on "Sync now"), `stopped` (no relay traffic).

**REST:**
- `GET /api/agent/mappings` — what this machine watches + mode
- `GET /api/agent/manifest/:projectId` — `{filename, hash, updated_at}[]`
- `GET /api/agent/pull/:projectId/:filename` — canonical content
- `POST /api/agent/push/:projectId` — `{filename, content, base_hash}`

**Conflict detection:** agent tracks per-file `base_hash` (last known
canonical). On push: `base_hash` matches canonical (or no prior state) →
**forward update**, accept + fan out. `base_hash` ≠ canonical → **genuine
conflict**: store candidate separately, open `conflicts` row, notify — do
**not** overwrite canonical.

**Resolution:** only the conflicting file pauses; others keep syncing.
1. **Auto-merge first** (append-only case): shared prefix + union of each
   side's unique trailing lines, ordered by each line's own timestamp.
   No data lost, no user action.
2. **Manual picker** only for true divergence (same line rewritten on
   both sides): UI shows project, filename, diverging machines,
   last-modified hint, "keep Machine X's version".
Either path writes resolved content as new canonical, fans out, marks
resolved, resets `base_hash`.

**Offline reconciliation** on (re)connect: fetch manifest → diff local →
pull newer → push local changes → resume live watch. Manual mode runs the
same on-demand.

**Deletions** never auto-propagate; next reconciliation re-creates the
file from the Hub's canonical copy. Explicit "remove everywhere" is a
future manual UI action.

## 7. WebSocket relay

- `/ws/agent?token=<machine_token>` — live push fan-out (auto),
  `trigger_sync` (manual), heartbeat → drives online/sleeping status.
- `/ws/user?token=<session_token>` — live dashboard + notification-center
  updates.

## 8. Auth & security

Email/password (scrypt, no external dep) · bearer session token for
UI/API · machine tokens (`X-Machine-Token`) shown once at creation ·
pairing codes for onboarding · HTTPS/`wss` via Coolify+Cloudflare ·
machine-token file perms locked down · relay store off any public volume
(at-rest encryption flagged before non-personal use).

**Deferred (v1):** rate-limiting/brute-force protection, password-reset
flow — acceptable for a small trusted user set; flag before wider use.

## 9. API reference

**User-facing (Bearer session token)**
```
POST   /api/auth/signup            POST   /api/auth/login
POST   /api/auth/logout            GET    /api/auth/me
PUT    /api/auth/me/notify-webhook

GET    /api/machines               POST   /api/machines
DELETE /api/machines/:id           POST   /api/machines/pair   (issue code)

GET    /api/projects               POST   /api/projects
DELETE /api/projects/:id           PUT    /api/projects/:id/sync-mode
PUT    /api/projects/:id/mappings/:machineId
DELETE /api/projects/:id/mappings/:machineId
POST   /api/projects/:id/sync-now
GET    /api/projects/:id/conflicts
POST   /api/projects/:id/conflicts/:conflictId/resolve

GET    /api/dashboard/metrics      GET    /api/dashboard/activity
GET    /api/notifications          POST   /api/notifications/:id/read
POST   /api/notifications/read-all
```

**Agent-facing (X-Machine-Token header)**
```
GET  /api/agent/mappings           GET  /api/agent/manifest/:projectId
GET  /api/agent/pull/:projectId/:filename
POST /api/agent/push/:projectId    POST /api/agent/pair/redeem
```

**WebSocket:** `/ws/agent?token=…` · `/ws/user?token=…`

## 10. UI screens

Login/Signup · Dashboard (metrics tiles + recent projects + activity +
sync-engine status) · Projects list · Project detail (machine↔folder
mappings, sync progress, sessions, activity) · Machines (cards +
pairing-code connect) · Conflicts · Notifications · Settings (webhook) ·
Profile · 404. Built from the redesign HTML/CSS, wired to real endpoints.

## 11. Notifications

In-hub center (primary) · optional per-user webhook relay (best-effort,
non-blocking) · Phase 7 native OS toasts. No Teams/Telegram (Telegram
blocked in PK where the Hub is hosted; free Teams unreachable via n8n).

## 12. Tech stack

- **Hub:** Node 22, Express, `better-sqlite3`, `ws`, vanilla HTML/CSS/JS.
- **Agent:** Node, `chokidar`, native `fetch`, `ws` client, `node-notifier` (P7).
- **Phase 7:** Electron tray (optional).
- **Deploy:** Coolify on `mylogiclab.cloud` + Cloudflare Tunnel.

## 13. Implementation decomposition

Too large for one plan → built incrementally with checkpoints. Each
sub-project gets its own plan → build → verify cycle.

1. **Hub core** — schema, auth, machines/projects/mappings CRUD, static UI shell on real auth.
2. **Sync protocol** — agent endpoints, `file_state`, forward-update, `events`.
3. **Conflicts** — `base_hash`, auto-merge, manual resolution + UI.
4. **WebSocket relay** — live fan-out, `trigger_sync`, heartbeat/status, live UI.
5. **Metrics & notifications** — events-backed tiles, notification center, webhook relay.
6. **Agent** — watcher, debounce, reconciliation, pairing onboarding, OS-service packaging (Win/mac/Linux).
7. **Phase 7** — native toasts, then optional Electron tray.

## 14. Deferred / open

Delta/patch transfer (whole-file for now) · relay pruning/caps ·
rate-limit + password reset · relay at-rest encryption · IP-display
privacy toggle · "remove session everywhere" manual action.
