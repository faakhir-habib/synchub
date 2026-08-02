# SyncHub → Proper App: Re-Architecture Design

**Date:** 2026-08-01
**Status:** Approved (design), Phase 1 ready for planning
**Author:** Faakhir Habib (with Claude Code)

## 1. Context & Goal

SyncHub currently is a working, minimal, self-hosted tool that syncs Claude Code
session transcripts (`~/.claude/projects/<hash>/*.jsonl`) across machines. It is
built as:

- **Hub** — Node.js + Express + `ws` + `node:sqlite`, vanilla HTML/JS multi-page UI.
- **Agent** — Node.js CLI (chokidar watcher) + optional Electron tray.

All 7 original phases are implemented (38 tests). The code is clean and the sync
core (append-only auto-merge, relay store, conflict flow) is genuinely good.

**The goal has changed:** the owner wants SyncHub to become a **proper,
open-source, self-hosted project** — something the community can self-host,
contribute to, and rely on. There is **no requirement to stay minimal**.

Two goals are in tension and both must be honored:

1. **Easy to self-host** — an OSS self-hosted tool must be trivial to run. The
   current "single process + SQLite, no native deps" property is an **asset**,
   not a weakness, and must be preserved (one container for the Hub; one binary
   for the Agent). We are NOT adding Postgres/Redis/microservices.
2. **Contributor-friendly** — the stack must be familiar and well-structured:
   TypeScript everywhere, a mainstream frontend framework, an opinionated backend
   structure, shared types, tests, and CI.

### The immediate pain that triggered this

Every navigation click causes a **full page reload**. Root cause: the UI is a
multi-page app (`dashboard.html`, `projects.html`, …), so each click re-runs
`initShell()` — which **tears down and reconnects the WebSocket**, re-fetches
`/api/auth/me` + `/api/conflicts` + `/api/notifications`, re-parses the duplicated
sidebar/topbar, and flashes empty "—" placeholders. Moving to a React SPA fixes
this structurally: the shell and WebSocket mount **once**; only route content
changes.

## 2. Target Architecture (end state)

Everything is TypeScript in a single **pnpm monorepo**. Deployment stays simple:
Hub = one Docker container (SQLite file on a volume); Agent = one binary.

```
synchub/  (pnpm monorepo)
├── packages/
│   └── shared/          # TypeScript types + zod schemas = the API/protocol
│                        #   contract. Backend, frontend, and agent all import it.
├── apps/
│   ├── hub-api/         # NestJS + Prisma (SQLite). Sync engine, auth,
│   │                    #   WebSocket gateway, REST API.
│   ├── hub-web/         # React + Vite + TS. SPA — persistent WebSocket + shell,
│   │                    #   TanStack Router + TanStack Query.
│   └── agent/           # Lightweight TS CLI → single self-contained binary
│                        #   per OS. chokidar watcher + OS service installer.
├── docs/                # OSS docs: self-hosting, architecture, contributing
└── docker-compose.yml   # one-command self-host (hub-api + built hub-web static)
```

### Key decisions and rationale

- **`packages/shared` as the typed contract.** API DTOs, sync-protocol messages
  (`manifest`/`pull`/`push`), and WebSocket message shapes are defined once as
  `zod` schemas with inferred TS types. Backend uses them for runtime validation;
  frontend and agent get typed clients. Change a shape in one place → type errors
  surface in every consumer. This is the heart of "contributor-friendly."

- **Frontend as a React SPA, served alongside the API.** `hub-web` builds to
  static assets that `hub-api` serves (NestJS `ServeStaticModule`) — one origin,
  no CORS. The SPA mounts the shell + WebSocket once; navigation only swaps route
  content. **This is the structural fix for the full-page-refresh pain.**

- **Sync core is ported, not rewritten.** `merge.js` (append-only auto-merge),
  `relayStore.js`, and the conflict flow are proven. They become typed NestJS
  services (`MergeService`, `RelayStore`, `SyncService`) with their tests ported
  and expanded. Business logic is preserved verbatim in behavior.

- **SQLite via Prisma.** `schema.prisma` is the single source of truth with real
  migrations (replacing today's manual `ALTER TABLE` try/catch), typed queries,
  and no sync-blocking `DatabaseSync`. **SQLite only** for now — Postgres is
  explicitly out of scope (YAGNI); the ORM leaves the door open if ever needed.

- **Agent optimized for easy install.** A lightweight **TS CLI** (not NestJS —
  too heavy for a watcher) compiled to a **single self-contained binary** per OS
  (Node 22 SEA / Bun `--compile` / `pkg`), published to GitHub Releases with a
  one-line install script that registers an OS background service
  (systemd/launchd/Windows Service). The optional Electron tray is a separate,
  heavier download. End user runs one command per machine — no Node/npm required.

- **Deployment stays simple.** Self-hoster: `docker compose up` (Hub) + agent
  binary via install script. No Postgres, no Redis.

## 2.1 Realtime — a First-Class Requirement

The app must feel **fully live**: nothing important should require a page refresh
or a manual "Refresh" click. An audit of the current app found that realtime is
largely **broken today** — presence is written to the DB but never pushed to the
browser, the client's `changed` handler is dead code (the server only emits
`changed` to agents, never to user sockets), there is no sync-progress messaging
at all (the UI fabricates "100%"), normal syncs raise no notification, and the
browser WebSocket never reconnects after a drop. See §7 for the full list.

The rewrite makes these guarantees, driven end-to-end over WebSocket:

1. **Live presence** — when a machine goes online/offline, every open browser for
   that user updates the machine's status **without a refresh**.
2. **Live sync progress** — while a machine syncs, the relevant project/dashboard
   view shows real per-file progress (pushed/pulled counts), not a fake bar.
3. **Sync-complete notification** — when a reconcile finishes, the user gets a
   notification and the activity feed updates live. Conflicts surface live too.
4. **Live activity/data** — project and dashboard data patch in on `changed`
   events instead of polling or manual refresh.
5. **Resilient transport** — server↔agent **and** server↔browser sockets use
   app-level heartbeat (ping/pong + liveness timeout) so half-open connections are
   detected; both the browser and the agent **reconnect with backoff** and
   **re-reconcile on reconnect** so no event is silently missed.

### Realtime contract (typed in `packages/shared` from Phase 1)

The WebSocket message union is defined once and frozen early so later phases build
against it. Browser-directed messages (new — do not exist today):

- `presence` — `{ machineId, status: "online"|"offline", lastSeenAt }`
- `sync-progress` — `{ projectId, machineId, filename?, completed, total, phase: "scan"|"push"|"pull" }`
- `sync-complete` — `{ projectId, machineId?, at }`
- `conflict` — `{ projectId, filename, conflictId }` (live conflict surfacing)
- `changed` (browser-directed variant) — data invalidation for a project
- `notification` — existing

Agent-directed messages (retain today's semantics, renamed to avoid the collision
between the server→agent `sync` **trigger** and the server→browser `sync-complete`):

- `changed` (agent-directed) — pull this file
- `sync-trigger` — manual-mode "sync now"
- `welcome` — handshake

## 3. Delivery Plan — 4 Phases

Each phase gets its own spec + implementation plan and keeps the app working. The
old `hub/` and `agent/` directories stay **untouched** until the new equivalents
are feature-complete, then are archived/deleted.

1. **Phase 1 — Monorepo foundation** (detailed below; built first). Includes the
   full realtime WS contract (§2.1) frozen in `packages/shared`.
2. **Phase 2 — Backend:** NestJS + Prisma; port sync/merge/relay/conflict logic
   into typed modules; WebSocket gateway; auth guards. Fixes the server-side audit
   findings (§7): broadcast presence/progress/complete to browsers, always-merge
   (drop `base_hash` trust), session expiry, SSRF-guarded webhooks, rate limiting,
   transactional push, WS heartbeat, store-file cleanup, versioned migrations.
3. **Phase 3 — Frontend:** React + Vite SPA; app-shell + routes; persistent WS;
   TanStack Query/Router. The nav-refresh pain is resolved here, and the live UI
   (presence, progress, activity, reconnect) from §2.1 is implemented — replacing
   today's dead `changed` handler, 10 s polling, and manual-refresh machines page.
4. **Phase 4 — Agent:** TS conversion; single-binary releases; install script;
   OS service registration. Fixes the agent audit findings (§7): crash-safe atomic
   state, delete/rename propagation, single serialized sync queue, WS heartbeat +
   reconnect-triggered reconcile, incremental push for live sessions, token
   refresh/re-pair, and a user-independent config path in the service units.

## 4. Phase 1 — Monorepo Foundation (first spec)

**Purpose:** stand up a TypeScript monorepo skeleton that the other three phases
plug into. Break no existing feature; the new scaffold grows alongside the old app.

### Deliverables

**4.1 Monorepo tooling**
- `pnpm` workspaces (`pnpm-workspace.yaml`) covering the three apps + shared package.
- Root `tsconfig.base.json` with `strict: true` and path aliases (`@synchub/shared`).
- Shared **ESLint (flat config) + Prettier** for consistent contributor code.
- Root scripts: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`.

**4.2 `packages/shared` — typed contract (core of Phase 1)**
`zod` schemas + inferred TS types, derived by reading the existing code (no
guesswork), covering:
- **API DTOs** — auth (signup/login/me), projects, machines, mappings, conflicts,
  notifications, dashboard stats.
- **Sync protocol** — `manifest`, `pull`, `push` request/response shapes (from
  `hub/src/routes/agent.js`).
- **WebSocket messages** — the **full realtime contract** from §2.1 (not just
  today's four): browser-directed `presence`, `sync-progress`, `sync-complete`,
  `conflict`, `changed`, `notification`; agent-directed `changed`, `sync-trigger`,
  `welcome`. Frozen here so Phases 2–3 build against a stable typed union.

**4.3 `apps/hub-api` — NestJS skeleton**
- `nest new` structure; `GET /health` endpoint; Prisma module wired.
- **`schema.prisma`** translated 1:1 from `hub/src/schema.sql` **plus** the
  migrations added in `hub/src/db.js`. Models: `User` (incl. `name`,
  `notify_webhook_url`, `notify_conflicts`, `notify_sync`), `Session`, `Machine`,
  `PairingCode`, `Project`, `Mapping`, `FileState`, `Conflict`, `Notification`,
  `Event`. Preserve unique constraints and indexes. Generate the first migration.
- No business logic yet — skeleton + DB connect + a demonstration that a
  `packages/shared` type flows through an endpoint.

**4.4 `apps/hub-web` — React + Vite skeleton**
- Vite + React + TS; TanStack Router + TanStack Query wired.
- App-shell (sidebar + topbar, based on the current design) + a "Dashboard" route
  that calls `hub-api`'s `/health` via a typed client from `packages/shared`.
- Proves the full pipeline end-to-end: typed contract → API → React SPA, no page
  refresh.

**4.5 `apps/agent` — TS skeleton**
- `package.json` + `tsconfig` + a runnable `synchub-agent --version` CLI. Real
  logic lands in Phase 4.

### Success criteria (Phase 1 "done")
- `pnpm install && pnpm build` builds the whole monorepo with no errors.
- `pnpm dev` runs hub-api + hub-web; the browser dashboard skeleton shows live
  data from `/health`, typed end-to-end.
- Changing a schema in `packages/shared` produces a TS type-error in a dependent
  app (the contract works).
- The old `hub/` and `agent/` still run as-is — Phase 1 does not touch them.

### Scope decision
Phase 1 does **not** modify or remove the existing `hub/` and `agent/`. New work
lives in `apps/` + `packages/`. The old Hub is archived/deleted only once Phases
2–3 are feature-complete, so something always runs.

## 5. Cross-Cutting Principles (apply to every phase)

### Testing
- **Backend (NestJS):** Jest. Port and expand the existing 34 hub tests; the sync
  core (`MergeService` etc.) must not lose coverage.
- **Frontend (React):** Vitest + React Testing Library. Phase 1: one smoke test
  (dashboard renders + `/health` call).
- **Shared:** round-trip tests for `zod` schemas (valid/invalid parse).
- **CI:** GitHub Actions runs `pnpm lint && pnpm build && pnpm test` on every PR.

### Error handling
- **API:** NestJS exception filters → a consistent JSON error shape
  (`{ error, code }`) that is typed in `packages/shared`.
- **Validation:** request validation via `zod` (NestJS `ZodValidationPipe`);
  invalid input rejected before handlers.
- **Frontend:** TanStack Query loading/error states with real loading skeletons
  instead of flashing "—" placeholders.

### Docs (OSS differentiator)
- `README.md` — what it is, quick self-host (`docker compose up`), agent install
  one-liner.
- `docs/self-hosting.md`, `docs/architecture.md`, `CONTRIBUTING.md` (monorepo dev
  setup), `docs/agent-install.md`.
- Design specs remain in `docs/superpowers/specs/`.

## 6. Explicit Non-Goals
- No Postgres, Redis, or multi-service architecture (SQLite + single process only).
- No multi-tenant SaaS / billing / public signup infrastructure.
- No horizontal scaling / HA of the Hub (in-memory WebSocket registry is fine for
  a single-process self-host).
- No delta-sync / protocol changes in this effort (full-file sync is retained;
  delta-sync is a possible future improvement, tracked separately).

## 7. Existing-App Issues to Fix in the Rewrite

A full audit of the current `hub/` and `agent/` code produced the list below. Each
item names the phase that fixes it. Severity: **C**ritical / **H**igh / **M**edium
/ **L**ow. This is the backlog the rewrite must clear, not just a re-skin.

### 7.1 Realtime (mostly Phase 2 server + Phase 3 client)
- **C** Presence never reaches the browser — `realtime.js` writes machine
  `status` to the DB but has no broadcast to user sockets; machines page updates
  only on manual "Refresh". → live `presence` broadcast.
- **C** Client `changed` handler is dead — `notifyProjectChanged` emits only to
  agents, never to user sockets, so dashboard/project views go stale. → emit
  browser-directed `changed`; drop the 10 s poll.
- **H** No sync progress/complete signalling — no progress events exist; the UI
  fabricates "100%"; normal (non-conflict) syncs raise no notification. → real
  `sync-progress`/`sync-complete` events + notification.
- **M** No browser WS reconnect (`app-shell.js` opens once, no backoff) and no
  server↔client/agent heartbeat → phantom-online machines, silent dead sockets.
  → ping/pong + liveness timeout + reconnect-with-backoff on both ends.

### 7.2 Security (Phase 2)
- **H** Sessions never expire or rotate (no `expires_at`); token in `localStorage`.
  → expiring/refreshable sessions, prune on logout.
- **H** Webhook URL is an unauthenticated SSRF vector (`notify.js` fetches it
  verbatim). → scheme/host validation, block private/link-local, no redirects.
- **H** No rate limiting on login/signup/pairing-redeem; 6-char pairing codes with
  unlimited attempts. → per-IP/account throttling, attempt caps, longer codes.
- **H** `base_hash` is trusted for correctness — a lying/buggy agent can overwrite
  canonical with no merge (silent data loss). → always `autoMerge` against stored
  canonical; verify claimed base is a real prefix.
- **L** Timing-unsafe secret lookups, case-sensitive email uniqueness, `http://`
  hub URLs accepted, machine token in WS URL query string, plaintext token on disk
  (chmod is a no-op on Windows). → constant-time compares, email normalization,
  enforce HTTPS (non-localhost), token via upgrade header, OS keystore/DPAPI.

### 7.3 Correctness & reliability (Phase 2 server / Phase 4 agent)
- **C** (agent) Local deletions are resurrected — reconcile re-pulls any file the
  hub still has; no delete propagation (`state.del` is dead code). → bidirectional
  delete with tombstones + a hub soft-delete path.
- **C** (agent) Corrupt/truncated state or config crash-loops the agent on boot
  (unguarded `JSON.parse`, non-atomic writes). → try/catch + atomic temp-file rename.
- **H** (agent) Overlapping reconciles — the 30 s timer has no reentrancy guard;
  concurrent runs double-push and race the state file. → single serialized sync
  queue.
- **H** (agent) `awaitWriteFinish` + debounce stalls live-session sync — an active
  transcript is never "stable", so nothing syncs until the session idles. →
  incremental append-based push for live sessions.
- **H** (agent) Non-JSON hub responses (413/502/HTML) throw and abort the whole
  reconcile batch (`api.js` parses unconditionally). → guard parsing, per-file
  try/catch, treat non-2xx distinctly.
- **M** Push is non-atomic across filesystem + DB (no transaction); a crash between
  `store.write` and `fileState.upsert` diverges content and hash. → wrap in a
  transaction, DB as source of truth.
- **M** Orphaned relay-store files never cleaned on project/machine/user delete;
  unresolved conflict candidates never GC'd → unbounded disk growth. → cascade
  store cleanup + candidate sweep.
- **M** "Manual" sync mode still auto-pushes every 30 s (only `stopped` is
  excluded). → gate pushes on `auto`; manual = pull/on-demand only.
- **M** Watcher debounce-timer map grows unbounded (leak); pull-writes echo back
  through the watcher causing redundant round-trips. → delete timers on fire;
  short-lived write-suppression set.
- **M** Local rename = duplicate (old resurrected + new pushed); `*.jsonl`
  directory entries crash reconcile (`EISDIR`). → rename detection; `stat` guard.
- **M** Unversioned migrations swallow **all** errors in `db.js`, not just
  "duplicate column" → silent half-applied schema. → versioned migration table
  (Prisma migrations, Phase 1).

### 7.4 Data model & misc (Phase 1 schema / Phase 2)
- **M** `last_ip` is shown in the UI but never written; no `trust proxy`. → capture
  `req.ip` on touch/pair.
- **L** Missing index on `mappings.machine_id` (hot path); candidate filename uses
  a 12-hex hash prefix (collision risk); `auto_merge` fabricates+resolves a
  conflict row just to log. → add index; full hash / conflict id; log via `events`.
- **L** No global Express error handler; unguarded client JSON parse; `.html`
  handler reads an arbitrary path from `req.path` without an allow-list. → error
  middleware + consistent shape; guarded parse; static allow-list.

### 7.5 Install & distribution (Phase 4)
- **H** Not a single binary / real service — needs Node ≥22 + `npm install`
  (native `node-notifier`, ~200 MB `electron` for the tray); service units hardcode
  node paths, run as root but read the installing user's `~/.synchub`, and the
  Windows "service" is a logon task (no Session-0). No auto-update. → SEA/pkg
  single binary, user-independent config path (`--config`/env in the unit),
  correct per-OS units, an update channel.
