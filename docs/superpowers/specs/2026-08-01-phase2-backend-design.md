# Phase 2 — Backend (NestJS + Prisma) Design

**Date:** 2026-08-01
**Status:** Design v2 (revised after critical review) — awaiting approval before planning
**Parent:** `2026-08-01-synchub-proper-app-design.md` (Phase 2)
**Legacy source of truth:** the existing `hub/src/**` (mapped in full during planning).

## 1. Goal

Port the legacy Express/`node:sqlite` Hub to typed **NestJS + Prisma (SQLite)**,
preserving every REST endpoint, the WebSocket protocol, and the sync-engine
behavior **exactly** — while implementing the realtime upgrades (spec §2.1) and
clearing the server-side audit backlog (spec §7). The legacy `hub/` stays running
untouched until Phase 3 replaces its UI; Phase 2 builds `apps/hub-api` to full
feature parity behind the same HTTP + WS **API/WS contract**.

**Scope of "parity" (B1):** hub-api is a **headless API + WebSocket server** — it
does NOT serve any HTML/UI. The legacy vanilla UI (and its importmap/cache-buster
static middleware in `hub/src/app.js`) is deliberately NOT ported — it is thrown
away in Phase 3, so porting it would be wasted work. During Phase 2 the legacy
`hub/` process keeps serving its own UI from its own port for manual sanity checks;
hub-api's correctness is proven by (a) its own e2e test suite against the contract
and (b) pointing the **real legacy agent** at hub-api and confirming sync works.
Static serving of the Phase-3 React build (via `ServeStaticModule`) is a Phase-3
concern, per the master spec. So Phase 2 parity = **REST + WebSocket behavior**, not
HTML serving.

Success = the new `hub-api` reproduces every REST endpoint + the WS protocol with no
behavior change an API/WS client can observe, **plus** the new realtime events and
security fixes.

## 2. Module structure (NestJS)

Each legacy concern becomes a NestJS module. All request/response shapes come from
`@synchub/shared` (extended as needed); all DB access goes through `PrismaService`.

```
apps/hub-api/src/
├── prisma/            # (exists) PrismaService, PrismaModule
├── common/
│   ├── auth/          # SessionAuthGuard (Bearer), MachineAuthGuard (X-Machine-Token)
│   ├── crypto/        # CryptoService: scrypt password hash/verify, sha256, tokens
│   └── errors/        # exception filter → { error, code } (typed in shared)
├── users/             # signup/login/logout/me + profile + webhook (auth module)
├── machines/          # machines CRUD + pairing. pair/redeem = its OWN controller, NO guard
├── projects/          # projects CRUD + mappings + sync-now + the nested conflicts routes
│                      #   incl. POST /api/projects/:id/conflicts/:conflictId/resolve (I2)
├── sync/              # AGENT-facing: mappings, manifest, pull, push (the engine)
│   ├── merge.service.ts      # autoMerge (ported verbatim from lib/merge.js)
│   └── relay-store.service.ts# flat-file store (ported from lib/relayStore.js)
├── conflicts/         # ConflictsService (list + resolve LOGIC) — HTTP routes for resolve
│                      #   stay on ProjectsController at the legacy nested path (I2)
├── notifications/     # list/read/read-all + NotifyService (see split below, B4)
├── dashboard/         # metrics + activity (StatsService)
└── realtime/          # RealtimeGateway (raw ws server on the HTTP server): /ws/agent, /ws/user
```

Shared services: `CryptoService`, `RelayStoreService`, `MergeService`, `NotifyService`,
and the `RealtimeGateway` are injectable singletons threaded via DI (replacing the
legacy "construct once in app.js, pass into routers" pattern).

**NotifyService is split (B4)** so 2b's ported sync handlers keep parity without
pulling all of 2c forward:
- **`NotifyService` core** (built in 2a): preference-gate (`notify_conflicts`/
  `notify_sync`, only `conflict|sync` types gated) + **write the notification row**.
  This is the unskippable half `agent.js`/`projects.js` call as `notifyUser`.
- **2c layer** adds, behind the same method, the live **WS push** (`pushNotification`)
  and the SSRF-guarded **webhook** POST. In 2b the WS/webhook side is a no-op stub;
  the DB row + gating already work, so the notifications bell/conflicts UI stay
  correct during the 2b window.

**Auth-guard mechanism (I1):** guards are applied **per-controller/per-route**, never
as a module-prefix or global `APP_GUARD`. `pair/redeem` lives in its own guardless
controller so it stays unauthenticated while every other `/api/agent/*` route uses
`MachineAuthGuard`.

**Global prefix (B2):** `main.ts` sets `app.setGlobalPrefix("api")` so all controllers
serve under `/api/*` (matching legacy). The container/infra healthcheck path
`GET /health` (the Phase-1 `{status,version,db}` probe) is **excluded** from the
prefix; a legacy-parity `GET /api/health` returning `{ ok: true }` is added for any
client that expects the legacy shape.

## 3. REST parity (exact port)

Every legacy endpoint is reproduced at the same path/method/auth. Auth via two
NestJS guards: `SessionAuthGuard` (reads `Authorization: Bearer`, resolves session
→ `req.user`) and `MachineAuthGuard` (reads `X-Machine-Token` → `req.machine`).
Request bodies validated by a `zod` pipe against `@synchub/shared` schemas;
responses shaped to the `public*` subsets (never leak password hash / tokens).

Endpoint groups (full list captured in the plan): auth (`/api/auth/*`), machines
(`/api/machines/*` + the guardless `/api/agent/pair/redeem`), agent sync
(`/api/agent/*`, machine auth), projects+mappings (`/api/projects/*`, incl. the
nested `/:id/conflicts/...` routes), conflicts (`GET /api/conflicts`), dashboard
(`/api/dashboard/*`), notifications (`/api/notifications/*`), plus `GET /api/health`
→ `{ ok: true }` (legacy parity; the richer `{status,version,db}` probe stays at the
prefix-excluded `/health`).

Preserve exact literals: sync-mode `auto|manual|stopped`; push statuses
`unchanged|behind|accepted|merged` (200) / `conflict` (409); event types
`push|auto_merge|conflict|conflict_resolved|sync_now`; notification gate types
`conflict|sync`; header names `Authorization: Bearer` / `X-Machine-Token`; WS paths
`/ws/agent` + `/ws/user` with `?token=`.

**NOT preserved (fixed per audit §7.4, B5):** the candidate relay-store filename
changes from the collision-prone `` `${filename}.cand.${hash.slice(0,12)}` `` to the
**full hash** (`` `${filename}.cand.${hash}` ``). This name is purely internal to the
relay store — it never appears in any API response (only `conflictId`/`filename` do)
— so `routes/agent.js` and `routes/projects.js`'s two independent call sites just
both use the new full-hash helper; no external contract changes.

## 4. Sync engine (the core — port behavior verbatim, then fix)

`MergeService.autoMerge(canonical, incoming)` is ported line-for-line from
`lib/merge.js` (longest-common-prefix → behind/forward/merged/conflict; union of
tails deduped; JSON.parse gate; timestamp stable-sort — V8's stable `Array.sort` is
relied on, which is safe on Node). Ported **first** with its tests as a regression
net before any behavior change (see §7 for the real test count).

The `POST /push/:projectId` decision tree is reproduced exactly (no-op → divergence
→ autoMerge outcomes → forward-update), with these audit fixes folded in:

- **§7.2 `base_hash` trust (data-loss) — FIXED:** whenever a `current` canonical
  exists, the push **always runs `autoMerge(canonical, incoming)`** and writes the
  merge result; it never blind-overwrites. `base_hash` becomes **advisory-only** (I3):
  it stays in the request shape for legacy-agent protocol compatibility but is
  **ignored for the write decision** — correctness comes entirely from the
  content-derived longest-common-prefix, so a lying/buggy/stale `base_hash` can never
  discard canonical lines. First-ever sync (no `current`) still writes directly.
  - *Observable-behavior check (I4):* the legitimate linear-append case
    (`base_hash === current.hash`, canonical is a true prefix of incoming) yields
    `autoMerge` → `forward` → `status: "accepted"` with the same final hash the
    legacy blind-write produced — the legacy agent handles it identically, so **no
    observable regression**. Cost: `autoMerge` (line-split + LCP scan) now runs on
    every push, not just divergent ones. Since the server already SHA-256s the full
    content per push, this is a constant-factor add on large transcripts, not a new
    order of magnitude — accepted tradeoff for eliminating the data-loss class.
- **§7.3 crash-safe canonical writes — FIXED via a content-addressed relay store
  (B3):** the new `RelayStoreService` stores each content blob at a path derived from
  its **own sha-256** (e.g. `<userId>/<projectId>/blobs/<hash>`), written to a temp
  file, `fsync`'d (file **and** its parent directory), then atomically `rename`d into
  place — write-once, never overwritten. `file_state.hash` (and a conflict row's
  `candidate_hash`) is the **pointer**; the Prisma `$transaction` that upserts
  `file_state` is what "activates" the new blob. A crash *after* the blob is durable
  but *before* the DB commits leaves only a harmless orphan blob — the DB still
  points at the old, unmodified blob, so content and hash can never diverge (this is
  what the naïve "fsync before commit" ordering could NOT guarantee). A periodic/boot
  **orphan-blob GC** removes blobs no `file_state`/`conflict` row references. `pull`
  resolves filename → `file_state.hash` → blob. (On-disk layout is new/internal to
  hub-api, so this redesign breaks no external contract.)
- **Realtime progress (§2.1):** push emits `sync-progress`/`sync-complete` to the
  owning user's browser sockets, and `presence` is broadcast on connect/disconnect
  (see §6). `changed` is emitted to **both** other agents (as today) **and** the
  user's browsers (fixing the dead client `changed` handler, §7.1).
- **Auto-merge audit-log cleanup (§7.4, M2):** the legacy "open a conflict row then
  immediately resolve it with `auto_merged=1` just to log an auto-merge" is dropped;
  auto-merges are recorded via the `events` table (`type: "auto_merge"`) only, not by
  fabricating+resolving a `conflicts` row.

Conflict resolution stays on `ProjectsController` at the **legacy nested path**
`POST /api/projects/:id/conflicts/:conflictId/resolve` (I2 — the legacy UI calls
exactly this), delegating to `ConflictsService`. Ported exactly (candidate vs
canonical), now inside a `$transaction`, emitting the browser-facing
`sync-complete`/`changed`.

## 5. Security hardening (spec §7.2)

- **Session expiry & rotation (I5):** add `expires_at DateTime?` to `Session` as a
  **nullable** column (Prisma migration — existing rows backfill to a computed
  `created_at + TTL`, or are simply treated as expired to force re-login; the plan
  picks one, but the column is added nullable to avoid a NOT-NULL-on-existing-rows
  migration failure). New sessions set `expires_at = now + TTL` (e.g. 30 days).
  `SessionAuthGuard` rejects `expires_at <= now`. **Sliding refresh is throttled** —
  extend `expires_at` only when less than, say, half the TTL remains, NOT on every
  request (avoids a DB write per API call under SQLite's single-writer model).
  `logout` deletes the row. A periodic sweep (via `@nestjs/schedule`, added to deps)
  deletes expired rows. Token stays a bearer token; httpOnly cookies deferred.
- **Webhook SSRF guard:** the 2c `NotifyService` layer validates the webhook URL —
  https/http scheme only, reject private/loopback/link-local IP ranges (resolve host,
  block RFC1918 + 127/8 + 169.254 + ::1 + ULA etc.), no redirects, a request timeout.
- **Input validation:** every body validated via `zod` before handlers; consistent
  `{ error, code }` errors via a global exception filter (typed in shared).
- **`last_ip` capture** (§7.4, I8): set `app.set("trust proxy", ...)` pinned to the
  **known proxy** (hop count `1` or the Coolify/Traefik address — the Hub runs behind
  a reverse proxy), NOT `true` (which lets any client spoof `X-Forwarded-For`).
  Persist `req.ip` on machine touch/pair so the UI's IP column is real.
- **Body limit (I7):** the Nest bootstrap must configure the JSON body limit to
  **25mb** (legacy `hub/src/app.js:29`) — Nest/Express default (~100kb) would 413
  large transcript pushes. Set via `bodyParser` options in `main.ts`.
- Constant-time token compares; email normalization (lowercase) on signup/login.

Out of scope for Phase 2 (tracked, not done): **rate limiting** (dropped per owner
decision — no throttling on login/signup/pair-redeem), moving tokens to httpOnly
cookies, delta-sync, horizontal scaling.

## 6. Realtime gateway (spec §2.1)

`RealtimeGateway` is a **raw `ws.WebSocketServer({ noServer: true })`** attached to
Nest's underlying HTTP server — obtained via `HttpAdapterHost.httpAdapter
.getHttpServer()` inside `onModuleInit` (NOT at construction; the adapter isn't ready
earlier) — mirroring `hub/src/lib/realtime.js:50-67`. We deliberately do **NOT** use
Nest's `@WebSocketGateway` (I6): its socket.io default and even the `ws` adapter
don't cleanly support two distinct upgrade paths (`/ws/agent`, `/ws/user`) with
different query-token auth without heavy custom-adapter work. The raw-`ws` approach
matches the legacy scheme almost verbatim. Responsibilities:

- **Registries:** `agentsByMachine`, `usersByUser` (in-memory, single-process — fine
  per spec non-goals). Auth on upgrade via `?token=` (machine token / session token).
- **Presence (§7.1 fix):** on agent connect/disconnect, update `Machine.status` AND
  **broadcast `presence` to the owning user's browser sockets** — the missing piece
  today. Dashboard/machines UIs patch live.
- **Heartbeat (§7.1 fix):** app-level ping/pong with a liveness timeout on both
  `/ws/agent` and `/ws/user`; on missed pong, `terminate` the socket **through the
  same offline-transition + `presence`-broadcast function the `ws.on("close")`
  handler uses** (M3 — one shared code path, never a parallel one that could forget
  to broadcast), so half-open sockets don't linger as phantom-online.
- **Progress/complete:** `sync-progress` + `sync-complete` emitted by the sync
  service during/after a push-driven reconcile; `conflict` emitted on a true conflict.
- **Agent-directed** `changed` (pull-this-file) and `sync-trigger` (manual sync now)
  preserved; the browser-directed variants added.
- Broker methods mirror legacy (`notifyProjectChanged`, `triggerSync`,
  `pushNotification`) plus new `broadcastPresence`, `syncProgress`, `syncComplete`.

## 7. Testing

- **Port the merge tests first** (M1: `hub/test/merge.test.js` has 4 cases; the whole
  legacy suite is ~36 across 16 files) → the new `MergeService`, expanded, as the
  regression net **before** any behavior change.
- Per module: e2e tests (supertest) for each endpoint group, using an in-memory /
  temp SQLite DB (Prisma). Auth guard tests. A sync-engine integration test that
  exercises the full push decision tree (unchanged/behind/accepted/merged/conflict)
  and the `base_hash`-trust fix (prove a wrong `base_hash` can't lose lines). A
  crash-safety test for the content-addressed store (blob durable before pointer
  commit; orphan GC). WS gateway tests for presence + progress + heartbeat.
- CI (already wired) runs it all.

## 8. Delivery — three sub-phases (each its own plan + execution)

Phase 2 is large, so it ships in three checkpointed sub-plans, each leaving hub-api
green and further along:

- **Phase 2a — Core + auth:** common (guards, crypto, errors), global `api` prefix +
  25mb body limit + trust-proxy, users (auth/profile/webhook), machines (+pairing),
  projects (+mappings), conflicts list, notifications CRUD, dashboard/stats,
  **`NotifyService` core** (DB row + preference gate). Session-expiry migration +
  guard + sweep. No agent sync yet.
- **Phase 2b — Sync engine:** `MergeService` (+ ported tests first), content-addressed
  `RelayStoreService` (+ crash-safety + orphan GC), agent endpoints
  (mappings/manifest/pull/push), conflict resolve at the legacy nested path — with the
  `base_hash`-advisory and content-addressed transactional fixes. Calls `NotifyService`
  core (already built in 2a); the WS side is a no-op stub until 2c.
- **Phase 2c — Realtime + hardening:** full `RealtimeGateway` (raw ws; presence/
  progress/complete + heartbeat sharing the close path + reconnect-safe), the
  `NotifyService` WS+webhook layer (SSRF-guarded), `last_ip` wiring, final security
  pass.

Each sub-phase: spec is this document's relevant section → its own bite-sized plan →
subagent-driven execution with spec + code review per task.

## 9. Non-goals (Phase 2)
- No frontend work (Phase 3). hub-api serves NO HTML; the legacy `hub/` keeps serving
  its own UI on its own port for manual checks during Phase 2.
- No agent changes (Phase 4). The legacy agent remains the client during Phase 2.
- No delete/rename sync semantics change, no delta-sync, no httpOnly cookies, no HA,
  no rate limiting (owner decision).

## 10. Critical-review resolutions (v2)
Addressed from the pre-planning review:
- **B1** UI serving — hub-api is headless (no HTML); legacy `hub/` serves UI during
  Phase 2; parity = REST+WS only (§1).
- **B2** `setGlobalPrefix("api")`; `/api/health` → `{ok:true}`; infra `/health`
  prefix-excluded (§2/§3).
- **B3** Crash-safety via **content-addressed** relay store (write-once blob keyed by
  hash; DB commit activates pointer; orphan GC) — replaces the insufficient
  "fsync-before-commit" claim (§4).
- **B4** `NotifyService` split — core (row + gate) in 2a, WS+webhook in 2c (§2/§8).
- **B5** Candidate filename → **full hash** (fixed per §7.4, internal only) (§3/§4).
- **I1** Guards per-controller; `pair/redeem` guardless controller (§2).
- **I2** Conflict-resolve stays on `ProjectsController` at the legacy nested path (§4).
- **I3** `base_hash` is advisory-only (kept for protocol compat, ignored for writes) (§4).
- **I4** Always-merge has no observable regression on the happy path; perf tradeoff
  noted (§4).
- **I5** `expires_at` nullable + backfill; throttled sliding refresh; `@nestjs/schedule`
  sweep (§5).
- **I6** Raw `ws` server via `HttpAdapterHost` in `onModuleInit`; `@WebSocketGateway`
  dropped (§6).
- **I7** 25mb body limit set in bootstrap (§5).
- **I8** `trust proxy` pinned to the known proxy, not `true` (§5).
- **M1** Test count corrected (§7). **M2** auto-merge logs via `events`, no fabricated
  conflict row (§4). **M3** heartbeat shares the close/offline path (§6). **M4** relay
  writes fsync file+dir then atomic rename (§4). **M5** confirmed non-issues.
