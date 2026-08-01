# Phase 2 — Backend (NestJS + Prisma) Design

**Date:** 2026-08-01
**Status:** Design — awaiting approval before planning
**Parent:** `2026-08-01-synchub-proper-app-design.md` (Phase 2)
**Legacy source of truth:** the existing `hub/src/**` (mapped in full during planning).

## 1. Goal

Port the legacy Express/`node:sqlite` Hub to typed **NestJS + Prisma (SQLite)**,
preserving every REST endpoint, the WebSocket protocol, and the sync-engine
behavior **exactly** — while implementing the realtime upgrades (spec §2.1) and
clearing the server-side audit backlog (spec §7). The legacy `hub/` stays running
untouched until Phase 3 replaces its UI; Phase 2 builds `apps/hub-api` to full
feature parity behind the same HTTP + WS contract.

Success = the new `hub-api` can serve the legacy web UI and the legacy agent with
no behavior change the client can observe, **plus** the new realtime events and
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
├── machines/          # machines CRUD + pairing (create code / redeem)
├── projects/          # projects CRUD + mappings + sync-now + per-project conflicts
├── sync/              # AGENT-facing: mappings, manifest, pull, push (the engine)
│   ├── merge.service.ts      # autoMerge (ported verbatim from lib/merge.js)
│   └── relay-store.service.ts# flat-file store (ported from lib/relayStore.js)
├── conflicts/         # list + resolve
├── notifications/     # list/read/read-all + NotifyService (webhook + WS + row)
├── dashboard/         # metrics + activity (StatsService)
└── realtime/          # RealtimeGateway (WS): /ws/agent, /ws/user, presence, progress
```

Shared services: `CryptoService`, `RelayStoreService`, `MergeService`, `NotifyService`,
and the `RealtimeGateway` are injectable singletons threaded via DI (replacing the
legacy "construct once in app.js, pass into routers" pattern).

## 3. REST parity (exact port)

Every legacy endpoint is reproduced at the same path/method/auth. Auth via two
NestJS guards: `SessionAuthGuard` (reads `Authorization: Bearer`, resolves session
→ `req.user`) and `MachineAuthGuard` (reads `X-Machine-Token` → `req.machine`).
Request bodies validated by a `zod` pipe against `@synchub/shared` schemas;
responses shaped to the `public*` subsets (never leak password hash / tokens).

Endpoint groups (full list captured in the plan): auth (`/api/auth/*`), machines
(`/api/machines/*` + `/api/agent/pair/redeem`), agent sync (`/api/agent/*`),
projects+mappings (`/api/projects/*`), conflicts (`/api/conflicts`), dashboard
(`/api/dashboard/*`), notifications (`/api/notifications/*`), and `GET /api/health`
(already exists, extended). Preserve exact literals: sync-mode `auto|manual|stopped`;
push statuses `unchanged|behind|accepted|merged` (200) / `conflict` (409); candidate
filename `` `${filename}.cand.${hash.slice(0,12)}` ``; event types
`push|auto_merge|conflict|conflict_resolved|sync_now`; notification gate types
`conflict|sync`.

## 4. Sync engine (the core — port behavior verbatim, then fix)

`MergeService.autoMerge(canonical, incoming)` is ported line-for-line from
`lib/merge.js` (longest-common-prefix → behind/forward/merged/conflict; union of
tails deduped; JSON.parse gate; timestamp stable-sort). Ported with its existing
34-test suite migrated to Jest/Vitest **first** (TDD safety net) before touching it.

The `POST /push/:projectId` decision tree is reproduced exactly (no-op → divergence
→ autoMerge outcomes → forward-update), with these audit fixes folded in:

- **§7.2 `base_hash` trust (data-loss) — FIXED:** the forward-update branch no
  longer blindly overwrites canonical when `base_hash === current.hash`. Instead it
  verifies the claimed base is actually the current canonical AND runs `autoMerge`
  whenever `current` exists, so a lying/buggy agent can never discard canonical
  lines. First-ever sync (no `current`) still writes directly.
- **§7.3 transactional push — FIXED:** the store-write + `file_state` upsert +
  event + conflict-row mutations run inside a Prisma `$transaction` (DB is source of
  truth); the relay file is written then fsync'd before the transaction commits, so
  a crash can't diverge content from hash.
- **Realtime progress (§2.1):** push emits `sync-progress`/`sync-complete` to the
  owning user's browser sockets, and `presence` is broadcast on connect/disconnect
  (see §6). `changed` is emitted to **both** other agents (as today) **and** the
  user's browsers (fixing the dead client `changed` handler, §7.1).

Conflict resolution (`/conflicts/:id/resolve`) ported exactly (candidate vs canonical),
now inside a transaction, emitting the browser-facing `sync-complete`/`changed`.

## 5. Security hardening (spec §7.2)

- **Session expiry & rotation:** add `expires_at` to `Session` (Prisma migration);
  `SessionAuthGuard` rejects expired tokens; sliding refresh on activity; `logout`
  deletes the row; a lightweight sweep removes expired rows. (Token stays a bearer
  token for now; httpOnly-cookie option deferred to a later hardening pass.)
- **Webhook SSRF guard:** `NotifyService` validates the webhook URL — https/http
  scheme only, reject private/loopback/link-local IP ranges (resolve host, block
  RFC1918 + 169.254 + ::1 etc.), no redirects, a timeout.
- **Input validation:** every body validated via `zod` before handlers; consistent
  `{ error, code }` errors via a global exception filter (typed in shared).
- **`last_ip` capture** (§7.4): set `req.ip` (with `trust proxy`) on machine touch
  / pair so the UI's IP column is real.
- Constant-time token compares; email normalization (lowercase) on signup/login.

Out of scope for Phase 2 (tracked, not done): **rate limiting** (dropped per owner
decision — no throttling on login/signup/pair-redeem), moving tokens to httpOnly
cookies, delta-sync, horizontal scaling.

## 6. Realtime gateway (spec §2.1)

`RealtimeGateway` (NestJS `@WebSocketGateway`, or a raw `ws` server attached to the
same HTTP server to match legacy `/ws/agent` + `/ws/user` paths and query-token
auth). Responsibilities:

- **Registries:** `agentsByMachine`, `usersByUser` (in-memory, single-process — fine
  per spec non-goals). Auth on upgrade via `?token=` (machine token / session token).
- **Presence (§7.1 fix):** on agent connect/disconnect, update `Machine.status` AND
  **broadcast `presence` to the owning user's browser sockets** — the missing piece
  today. Dashboard/machines UIs patch live.
- **Heartbeat (§7.1 fix):** app-level ping/pong with a liveness timeout on both
  `/ws/agent` and `/ws/user`; terminate + mark offline on missed pong, so half-open
  sockets don't linger as phantom-online.
- **Progress/complete:** `sync-progress` + `sync-complete` emitted by the sync
  service during/after a push-driven reconcile; `conflict` emitted on a true conflict.
- **Agent-directed** `changed` (pull-this-file) and `sync-trigger` (manual sync now)
  preserved; the browser-directed variants added.
- Broker methods mirror legacy (`notifyProjectChanged`, `triggerSync`,
  `pushNotification`) plus new `broadcastPresence`, `syncProgress`, `syncComplete`.

## 7. Testing

- **Port the merge suite first** (34 legacy tests → the new `MergeService`) as the
  regression net before any behavior change.
- Per module: e2e tests (supertest) for each endpoint group, using an in-memory /
  temp SQLite DB (Prisma). Auth guard tests. A sync-engine integration test that
  exercises the full push decision tree (unchanged/behind/accepted/merged/conflict)
  and the `base_hash`-trust fix. WS gateway tests for presence + progress + heartbeat.
- CI (already wired) runs it all.

## 8. Delivery — three sub-phases (each its own plan + execution)

Phase 2 is large, so it ships in three checkpointed sub-plans, each leaving hub-api
green and further along:

- **Phase 2a — Core + auth:** common (guards, crypto, errors, ratelimit), users
  (auth/profile/webhook), machines (+pairing), projects (+mappings), conflicts list,
  notifications CRUD, dashboard/stats. Session-expiry migration. No agent sync yet.
- **Phase 2b — Sync engine:** `MergeService` (+ ported tests), `RelayStoreService`,
  agent endpoints (mappings/manifest/pull/push), conflict resolve — with the
  `base_hash` and transactional-push fixes. Wired to a minimal realtime stub.
- **Phase 2c — Realtime + hardening:** full `RealtimeGateway` (presence/progress/
  complete + heartbeat + reconnect-safe), `NotifyService` (WS + webhook + SSRF
  guard), `last_ip`, final security pass.

Each sub-phase: spec is this document's relevant section → its own bite-sized plan →
subagent-driven execution with spec + code review per task.

## 9. Non-goals (Phase 2)
- No frontend work (Phase 3). The legacy UI remains the consumer during Phase 2.
- No agent changes (Phase 4). The legacy agent remains the client during Phase 2.
- No delete/rename sync semantics change, no delta-sync, no httpOnly cookies, no HA.
