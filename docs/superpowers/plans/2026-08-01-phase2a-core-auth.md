# Phase 2a: Core + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring `apps/hub-api` (NestJS + Prisma) to feature parity with the legacy Hub's **non-sync** surface: auth/users, machines+pairing, projects+mappings, conflicts-list, notifications (+NotifyService core), dashboard/stats — plus session expiry, the `api` global prefix, 25mb body limit, trust-proxy, and guards. No agent sync engine yet (Phase 2b), no realtime WS gateway yet (Phase 2c).

**Architecture:** Each legacy concern becomes a NestJS module (controller + service). All DB access via the existing `PrismaService`. All request/response shapes come from `@synchub/shared` (extended in Task 3). Two guards — `SessionAuthGuard` (Bearer) and `MachineAuthGuard` (X-Machine-Token) — applied per-controller. Behavior is ported **exactly** from the legacy code; where logic is non-trivial, the task cites the legacy `file:line` to replicate.

**Tech Stack:** NestJS 10, Prisma 6 (SQLite), zod (via `@synchub/shared`), Vitest + supertest + SWC (already wired), `@nestjs/schedule` (added in Task 11).

**Legacy source of truth (READ THESE — do not invent behavior):**
- Routes: `hub/src/routes/{auth,machines,projects,conflicts,dashboard,notifications}.js`
- Models: `hub/src/models/{users,sessions,machines,mappings,conflicts,notifications,events,projects,stats}.js`
- Lib: `hub/src/lib/{auth,crypto,notify}.js`, wiring in `hub/src/app.js`
- Prisma schema already models all tables: `apps/hub-api/prisma/schema.prisma`
- Design spec: `docs/superpowers/specs/2026-08-01-phase2-backend-design.md`

**Conventions for every task:**
- Windows PowerShell: `A && B` → `A; if ($?) { B }`; env var → `$env:VAR='x'; cmd`.
- Do NOT modify legacy `hub/` or `agent/`. All work in `apps/hub-api/` and `packages/shared/`.
- Local TS imports use `.js` extensions. NestJS files are CommonJS + decorators.
- Every service method that mutates uses `PrismaService`. Never leak `password_hash`/`password_salt`/`token` in responses — map to `public*` shapes.
- Int-as-boolean DB fields (`notify_conflicts`, `notify_sync`, `read`, `auto_merged`) → map `Int(0/1)` ↔ `boolean` at the service boundary (the shared DTOs are booleans; see `packages/shared/src/api.ts` note).
- Commit after each task; end commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run `pnpm --filter @synchub/hub-api test` after each task; keep it green.

---

## File Structure (created/modified in Phase 2a)

```
packages/shared/src/
├── api.ts                       # EXTEND: add all Phase-2a request/response schemas
apps/hub-api/src/
├── main.ts                      # MODIFY: setGlobalPrefix, body limit, trust proxy
├── app.module.ts                # MODIFY: register all new modules
├── common/
│   ├── crypto/crypto.service.ts # scrypt hash/verify, sha256, tokens
│   ├── auth/session-auth.guard.ts
│   ├── auth/machine-auth.guard.ts
│   ├── auth/current-user.decorator.ts   # @CurrentUser() / @CurrentMachine()
│   ├── errors/all-exceptions.filter.ts  # → { error, code }
│   └── validation/zod.pipe.ts           # ZodValidationPipe
├── users/{users.module,users.controller,users.service}.ts
├── machines/{machines.module,machines.controller,machines.service}.ts
├── projects/{projects.module,projects.controller,projects.service}.ts
├── conflicts/{conflicts.module,conflicts.controller,conflicts.service}.ts
├── notifications/{notifications.module,notifications.controller,notifications.service}.ts
├── notify/notify.service.ts     # NotifyService CORE (row + preference gate)
└── dashboard/{dashboard.module,dashboard.controller,dashboard.service}.ts
```

---

## Task 1: Bootstrap hardening + global concerns

**Files:**
- Modify: `apps/hub-api/src/main.ts`
- Create: `apps/hub-api/src/common/errors/all-exceptions.filter.ts`
- Create: `apps/hub-api/src/common/validation/zod.pipe.ts`
- Modify: `apps/hub-api/src/health/health.controller.ts` (add legacy `/api/health`)
- Test: `apps/hub-api/test/bootstrap.e2e.test.ts`

- [ ] **Step 1: Write failing test** `apps/hub-api/test/bootstrap.e2e.test.ts` — assert (a) `GET /api/health` → 200 `{ ok: true }`, (b) an unknown route under a controller returns the `{ error, code }` shape via the filter, (c) a body over-limit isn't rejected at 100kb (post ~200kb JSON to a throwaway echo or health, expect not-413). Use `Test.createTestingModule` + `app.setGlobalPrefix("api")` mirroring `main.ts`, and `supertest`.

- [ ] **Step 2: Run test, expect FAIL.** `pnpm --filter @synchub/hub-api test` — fails (no `/api/health`, no filter).

- [ ] **Step 3: Create `zod.pipe.ts`** — a `ZodValidationPipe` implementing `PipeTransform`: constructed with a `ZodSchema`, `transform(value)` runs `schema.safeParse`; on failure throw `BadRequestException` with `{ error: <message>, code: "validation_error" }`. Export a helper `zodBody(schema)` returning `new ZodValidationPipe(schema)` for use in `@Body(zodBody(Schema))`.

- [ ] **Step 4: Create `all-exceptions.filter.ts`** — a `@Catch()` filter: for `HttpException`, respond with the status and body `{ error, code }` (derive `error` from the exception response `message`/`error`; `code` from a passed field or a default like `http_<status>`); for unknown errors, 500 `{ error: "internal", code: "internal_error" }`. Register globally in `main.ts`.

- [ ] **Step 5: Modify `main.ts`** — after `NestFactory.create(AppModule, { bodyParser: true })`: `app.setGlobalPrefix("api", { exclude: ["health"] })` (keep the infra `/health` unprefixed); configure JSON body limit to 25mb via `app.useBodyParser?.("json", { limit: "25mb" })` or, if unavailable, `import { json } from "express"; app.use(json({ limit: "25mb" }))`; set trust proxy: `app.set("trust proxy", 1)` (pinned to one hop — the reverse proxy); register the global exception filter (`app.useGlobalFilters(new AllExceptionsFilter())`). Keep the existing listen/log.

- [ ] **Step 6: Add legacy `/api/health`** to `health.controller.ts` — add a second handler `@Get()` on a new `@Controller("api/health")`? No — simpler: keep `HealthController` at `@Controller("health")` (now served at `/api/health` because of the global prefix, EXCEPT it's excluded). Resolve cleanly: create `LegacyHealthController` at `@Controller("health")` returning `{ ok: true }` (this becomes `/api/health` under the prefix), and change the existing infra probe controller to `@Controller({ path: "health", host: undefined })` served at `/health` via the prefix `exclude`. Concretely: (a) rename the existing DB-probe controller path handling so it's the excluded `/health`; (b) add a new tiny controller returning `{ ok: true }` that lands at `/api/health`. Verify both paths respond.

- [ ] **Step 7: Run test, expect PASS.** `pnpm --filter @synchub/hub-api test`.

- [ ] **Step 8: Commit** `git add apps/hub-api && git commit -m "feat(hub-api): bootstrap — api prefix, 25mb body, trust proxy, error filter, zod pipe, /api/health"`.

---

## Task 2: CryptoService

**Files:**
- Create: `apps/hub-api/src/common/crypto/crypto.service.ts`, `crypto.module.ts`
- Test: `apps/hub-api/src/common/crypto/crypto.service.test.ts`

Port `hub/src/lib/crypto.js` verbatim into an injectable service.

- [ ] **Step 1: Write failing test** covering: `hashPassword(pw)` → `{hash,salt}`; `verifyPassword(pw, hash, salt)` true for correct, false for wrong; `verifyPassword` false on length mismatch (no throw); `hashContent("x")` equals the known sha256 hex of `"x"`; `randomToken()` returns a base64url string of expected length; two tokens differ.

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `CryptoService`** with methods `hashPassword(password, salt?)`, `verifyPassword(password, hash, salt)`, `hashContent(content)`, `randomToken(bytes=32)` — bodies copied from `hub/src/lib/crypto.js` (scryptSync 64-byte, timingSafeEqual with length check, sha256 hex, randomBytes base64url). Create `CryptoModule` (`@Global()`) providing+exporting it.

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): CryptoService (scrypt, sha256, tokens) ported from legacy`.

---

## Task 3: Session expiry migration + shared DTOs

**Files:**
- Modify: `apps/hub-api/prisma/schema.prisma` (Session.expires_at)
- Create: migration via `prisma migrate dev`
- Modify: `packages/shared/src/api.ts` (add Phase-2a schemas)
- Test: `packages/shared/test/schemas.test.ts` (a couple new round-trips)

- [ ] **Step 1: Add `expires_at DateTime?` (nullable) to `Session`** in `schema.prisma`. Run `pnpm --filter @synchub/hub-api exec prisma migrate dev --name session_expiry`. Verify the migration adds a nullable column (no NOT NULL on existing rows). Existing rows keep `expires_at = NULL`, which the guard (Task 4) treats as expired → forces re-login (documented choice).

- [ ] **Step 2: Extend `packages/shared/src/api.ts`** with the request/response schemas Phase 2a needs (add, do not remove existing). Add and export:
  - `SignupResponse = z.object({ token: z.string(), user: z.object({ id, email, name: z.string().nullable() }) })`
  - `LoginResponse = z.object({ token: z.string(), user: z.object({ id, email }) })`
  - `ProfileUpdateRequest = z.object({ name: z.string().nullable().optional(), notify_webhook_url: z.string().nullable().optional(), notify_conflicts: z.boolean().optional(), notify_sync: z.boolean().optional() })`
  - `WebhookUpdateRequest = z.object({ url: z.string().nullable() })`
  - `MachineCreateRequest = z.object({ name: z.string(), os: z.string().optional(), os_version: z.string().optional(), label: z.string().optional() })`
  - `PublicMachine = z.object({ id, name, os: nullable, os_version: nullable, label: nullable, agent_version: nullable, last_ip: nullable, status: MachineStatus, last_seen_at: nullable, created_at })` (reuse/extend the existing `Machine`)
  - `MachineWithToken = PublicMachine.extend({ token: z.string() })`
  - `PairCreateResponse = z.object({ code: z.string(), expires_in: z.number().int() })`
  - `PairRedeemRequest = z.object({ code: z.string(), name: z.string().optional(), os: z.string().optional(), os_version: z.string().optional(), label: z.string().optional(), agent_version: z.string().optional() })`
  - `PairRedeemResponse = z.object({ machineToken: z.string(), machineId: z.number().int() })`
  - `ProjectCreateRequest = z.object({ alias: z.string(), sync_mode: SyncMode.optional() })`
  - `ProjectUpdateRequest = z.object({ alias: z.string().optional(), sync_mode: SyncMode.optional() })`
  - `SyncModeRequest = z.object({ sync_mode: SyncMode })`
  - `MappingUpsertRequest = z.object({ local_path: z.string() })`
  - `ProjectDetail = Project.extend({ mappings: z.array(z.object({ machine_id: z.number().int(), local_path: z.string(), alias: z.string().nullable() })), tracked_files: z.number().int(), last_sync_at: z.string().nullable(), activity: z.array(z.any()) })`
  - `DashboardMetrics = z.object({ projects: z.object({ total: z.number().int(), syncing: z.number().int() }), machines: z.object({ total: z.number().int(), online: z.number().int() }), openConflicts: z.number().int(), eventsToday: z.number().int(), dataTransferredBytes: z.number().int(), sessionsSyncedToday: z.number().int(), syncSuccessRate: z.number(), avgLatencyMs: z.number().nullable(), unreadNotifications: z.number().int() })`
  - Update `MeResponse` to include `notify_webhook_url: z.string().nullable()` (legacy `publicUser` includes it — see `hub/src/routes/auth.js`).

- [ ] **Step 3: Add two round-trip tests** in `packages/shared/test/schemas.test.ts` (valid `DashboardMetrics`; invalid `ProjectCreateRequest` missing alias → `success:false`).

- [ ] **Step 4:** `pnpm --filter @synchub/shared build && pnpm --filter @synchub/shared test` (expect all pass) and `pnpm --filter @synchub/hub-api build` (prisma client regenerated).

- [ ] **Step 5: Commit** `feat(shared,hub-api): session expiry migration + Phase-2a DTOs`.

---

## Task 4: Auth guards + current-user decorators

**Files:**
- Create: `apps/hub-api/src/common/auth/{session-auth.guard,machine-auth.guard,current-user.decorator}.ts`, `auth.module.ts`
- Test: `apps/hub-api/test/guards.e2e.test.ts`

Port `hub/src/lib/auth.js` (`requireUser`, `requireMachine`) as Nest guards.

- [ ] **Step 1: Write failing e2e test** with a throwaway controller protected by each guard: (a) no/invalid Bearer → 401 `{error:"unauthorized"}`; valid session → 200 and `@CurrentUser()` is populated; (b) an expired session (`expires_at` in the past) → 401; a `NULL expires_at` session → 401 (treated expired); (c) `X-Machine-Token` invalid → 401; valid → 200 with `@CurrentMachine()`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `SessionAuthGuard`** — read `Authorization`, require exact `Bearer ` prefix, look up session JOIN user via Prisma (`session.findUnique({ where:{token}, include:{user} }`); reject if not found, or `expires_at == null`, or `expires_at <= now`. Attach `req.user` (full row) + `req.sessionToken`. **Sliding refresh (throttled):** if `expires_at` has less than half the TTL remaining, update it to `now + TTL`. Implement `MachineAuthGuard` — read `X-Machine-Token`, `machine.findUnique({where:{token}})`, attach `req.machine`. Both throw `UnauthorizedException({error:"unauthorized"})` on failure. Create `@CurrentUser()` and `@CurrentMachine()` param decorators reading from `req`. Put a TTL constant (30 days) in one place.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): SessionAuthGuard + MachineAuthGuard (expiry + sliding refresh) + decorators`.

---

## Task 5: Users module (auth + profile)

**Files:**
- Create: `apps/hub-api/src/users/{users.module,users.controller,users.service}.ts`
- Test: `apps/hub-api/test/users.e2e.test.ts`

Port `hub/src/routes/auth.js` + `hub/src/models/{users,sessions}.js`. Endpoints (all under `/api/auth`):
`POST /signup`, `POST /login`, `POST /logout` (session), `GET /me` (session), `PUT /me` (session), `PUT /me/notify-webhook` (session).

- [ ] **Step 1: Write failing e2e test** covering the full flow: signup (201 `{token,user}`); duplicate email → 409; short password (<8) or missing fields → 400; login ok → 200; bad creds → 401; `GET /me` with token → `publicUser` shape incl. `notify_webhook_url`, `notify_conflicts`/`notify_sync` as booleans; `PUT /me` updates name (truncated to 120) + toggles a notify boolean (persisted as Int); `PUT /me/notify-webhook` sets/clears url; `logout` then `GET /me` → 401. Email is normalized to lowercase (signup `A@x.com`, login `a@x.com` works).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `UsersService`** (Prisma) porting logic from `models/users.js` + `models/sessions.js` + `routes/auth.js`: `signup(email,password,name?)` — lowercase+validate email, min-8 password, hash via `CryptoService`, create user, create session (`createSession`: `randomToken()`, insert with `expires_at = now + TTL`), return `{token, publicUser}`; throw 409 on unique-email violation. `login` — lowercase email, `verifyPassword`, new session. `logout(token)` — delete session. `getMe(user)` → `publicUser` (map Int→boolean for notify flags, include `notify_webhook_url`, exclude hash/salt). `updateProfile(user, fields)` — whitelist `{name(≤120 or null), notify_webhook_url, notify_conflicts, notify_sync}`, only touch present keys, booleans→Int; return fresh `publicUser`. `setWebhook(user, url)`. Implement `UsersController` wiring these with `SessionAuthGuard` on the authed routes, `zodBody` validation, `@CurrentUser()`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): users module — signup/login/logout/me/profile/webhook`.

---

## Task 6: Machines module + pairing

**Files:**
- Create: `apps/hub-api/src/machines/{machines.module,machines.controller,machines.service}.ts`
- Create: `apps/hub-api/src/machines/pair-redeem.controller.ts` (guardless)
- Test: `apps/hub-api/test/machines.e2e.test.ts`

Port `hub/src/routes/machines.js` + `hub/src/models/machines.js`. Endpoints:
`GET /api/machines` (session), `POST /api/machines` (session), `DELETE /api/machines/:id` (session), `POST /api/machines/pair` (session), `POST /api/agent/pair/redeem` (**no guard**).

- [ ] **Step 1: Write failing e2e test:** create machine (201, returns `token` once, `publicMachine` otherwise); list (no token field); delete (404 if not owned); `POST /pair` → `{code, expires_in:600}`; `pair/redeem` with a valid code (unauthenticated request) → `{machineToken, machineId}` and the machine is owned by the code's user; redeem an expired/consumed/unknown code → 400; a redeemed code can't be redeemed twice.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `MachinesService`** porting `models/machines.js`: `listForUser`, `create(userId,name,extra)` (`randomToken()`), `remove(userId,id)` (ownership-scoped), `createPairingCode(userId, ttl=600)` (6-char `A-Z0-9` via `crypto.randomInt`, `expires_at = now + ttl s`), `redeemPairingCode(code, info)` (SELECT unconsumed+unexpired, create machine under the code's `user_id`, set `machine_id` to consume; return null on failure). `MachinesController` (session guard) + a separate `PairRedeemController` at `@Controller("api/agent")` (NO guard, but note: global prefix already adds `api`, so use `@Controller("agent")` → `/api/agent/pair/redeem`). Map Int→boolean not needed here; strip `token`/`user_id` via `publicMachine`.
  - Capture `last_ip`: on create/pair-redeem set `last_ip = req.ip` (trust-proxy pinned in Task 1).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): machines module + pairing (create code / guardless redeem)`.

---

## Task 7: Projects module + mappings

**Files:**
- Create: `apps/hub-api/src/projects/{projects.module,projects.controller,projects.service}.ts`
- Test: `apps/hub-api/test/projects.e2e.test.ts`

Port `hub/src/routes/projects.js` (minus `sync-now` and the conflict-resolve write, which need the sync engine / realtime — those land in 2b/2c) + `hub/src/models/{projects,mappings,fileState,events}.js`. Endpoints (all session):
`GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `PUT /api/projects/:id`, `PUT /api/projects/:id/sync-mode`, `DELETE /api/projects/:id`, `PUT /api/projects/:id/mappings/:machineId`, `DELETE /api/projects/:id/mappings/:machineId`, `GET /api/projects/:id/conflicts`.
**Defer to later phases (return 501 or omit for now, documented):** `POST /api/projects/:id/sync-now` (needs realtime, 2c) and `POST /api/projects/:id/conflicts/:conflictId/resolve` (needs relay store, 2b). Omit these two routes in 2a; they are added in 2b/2c.

- [ ] **Step 1: Write failing e2e test:** create project (`sync_mode` default `auto`; invalid mode → 400; dup alias → 409); list; `GET /:id` returns detail with `mappings`, `tracked_files` (count from `file_state`), `last_sync_at`, `activity` (recent events, ≤10); rename via PUT (empty alias → 400; dup → 409); `sync-mode` PUT (invalid → 400); mapping upsert (404 if project/machine not owned; missing local_path → 400) then delete; `GET /:id/conflicts` returns open conflicts for the project; not-owned project → 404 everywhere.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `ProjectsService`** porting `models/projects.js` (MODES `["auto","manual","stopped"]`, `findOwned`, `create`, `update`, `setSyncMode`, `remove`) + `models/mappings.js` (`upsert`, `remove`, `listForProject`) + project-detail assembly (`fileState` count, last event, `events.recentForProject(id,10)`). `ProjectsController` with session guard, zod bodies. Duplicate-alias → catch Prisma unique error → 409. Non-owned → 404.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): projects module + mappings (+ project detail)`.

---

## Task 8: NotifyService core + Notifications module

**Files:**
- Create: `apps/hub-api/src/notify/notify.service.ts`, `notify.module.ts`
- Create: `apps/hub-api/src/notifications/{notifications.module,notifications.controller,notifications.service}.ts`
- Test: `apps/hub-api/test/notifications.e2e.test.ts`, `apps/hub-api/src/notify/notify.service.test.ts`

Port `hub/src/models/notifications.js` + the **core** of `hub/src/lib/notify.js` (row + preference gate only; WS/webhook deferred to 2c).

- [ ] **Step 1: Write failing tests:** (notify unit) `NotifyService.notify({user_id,type:"conflict",title,body})` inserts a row when `notify_conflicts=1`; inserts NOTHING and returns null when `notify_conflicts=0`; same for `type:"sync"`/`notify_sync`; a type other than conflict/sync always inserts (no gate). (notifications e2e) `GET /api/notifications` → `{items(≤50), unread}`; `POST /:id/read` marks one (404 if not owned); `POST /read-all` clears unread.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `NotifyService` core** — `notify({user_id,type,title,body=null})`: load user, apply the gate exactly per `notify.js:9-10` (`type==="conflict"` skip if `notify_conflicts===0`; `type==="sync"` skip if `notify_sync===0`; other types bypass), return null if gated; else insert the notification row (return it). **Leave a clearly-marked hook** (`this.realtime?.pushNotification(...)` and webhook) as a no-op TODO for 2c — but structure the method so 2c only adds behavior, not signature changes. Make it `@Global()` so 2b can inject it. Implement `NotificationsService` (`listForUser` ≤50 ordered desc, `unreadCount`, `markRead(userId,id)`, `markAllRead(userId)`) + controller (session guard). Map `read` Int→boolean in responses.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): NotifyService core (row + gate) + notifications module`.

---

## Task 9: Conflicts list module

**Files:**
- Create: `apps/hub-api/src/conflicts/{conflicts.module,conflicts.controller,conflicts.service}.ts`
- Test: `apps/hub-api/test/conflicts.e2e.test.ts`

Port `hub/src/routes/conflicts.js` + `hub/src/models/conflicts.js` (list functions only; `resolve` write is 2b).

- [ ] **Step 1: Write failing e2e test:** `GET /api/conflicts` (session) returns all OPEN conflicts across the user's projects, each with `project_alias`, ordered newest first; only the caller's conflicts appear. Seed conflicts directly via Prisma.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `ConflictsService.listOpenForUser(userId)`** (JOIN projects, ownership + `status='open'`, include `project_alias`) and `listOpenForProject` (used by projects Task 7 — export it or keep it here and have projects import). Map `auto_merged` Int→boolean in responses. `ConflictsController` `GET /api/conflicts` with session guard. (Resolve endpoint deferred to 2b.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): conflicts list module`.

---

## Task 10: Dashboard / stats module

**Files:**
- Create: `apps/hub-api/src/dashboard/{dashboard.module,dashboard.controller,dashboard.service}.ts`
- Test: `apps/hub-api/test/dashboard.e2e.test.ts`

Port `hub/src/routes/dashboard.js` + `hub/src/models/{stats,events}.js`. Endpoints (session): `GET /api/dashboard/metrics`, `GET /api/dashboard/activity?limit`.

- [ ] **Step 1: Write failing e2e test:** seed projects/machines/events/conflicts for a user, assert `metrics` matches the legacy `dashboardMetrics` computation — `projects{total,syncing}`, `machines{total,online}`, `openConflicts`, `eventsToday`, `dataTransferredBytes`, `sessionsSyncedToday` (DISTINCT project/filename for today's push+auto_merge), `syncSuccessRate` (7-day, one-decimal %, defaults 100 with no data), `avgLatencyMs` (today, null if none), `unreadNotifications`. `activity` returns recent events, `limit` clamped ≤100 default 20.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `DashboardService.metrics(userId)`** replicating each query in `hub/src/models/stats.js:dashboardMetrics` (use Prisma `$queryRaw` for the date/aggregate ones — `date(created_at)=date('now')`, the DISTINCT concat, the 7-day success rate with the 100-default, `AVG(latency_ms)` rounded) and `activity(userId,limit)` from `events.recent`. Controller with session guard, `limit` parse+clamp.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(hub-api): dashboard metrics + activity`.

---

## Task 11: Session sweep + wire AppModule + full verification

**Files:**
- Modify: `apps/hub-api/src/app.module.ts` (register all modules + schedule)
- Create: `apps/hub-api/src/common/auth/session-sweep.service.ts`
- Modify: `apps/hub-api/package.json` (add `@nestjs/schedule`)
- Test: `apps/hub-api/test/app.e2e.test.ts`

- [ ] **Step 1: Add `@nestjs/schedule`** to hub-api deps; `pnpm --filter @synchub/hub-api install`.

- [ ] **Step 2: Create `SessionSweepService`** — `@Cron` (daily) deletes sessions where `expires_at IS NOT NULL AND expires_at <= now`. (NULL-expiry rows are left; they're already rejected by the guard — or optionally sweep them too; document the choice.)

- [ ] **Step 3: Wire `app.module.ts`** — `ScheduleModule.forRoot()`, `CryptoModule`, `AuthModule`, `UsersModule`, `MachinesModule`, `ProjectsModule`, `ConflictsModule`, `NotificationsModule`, `NotifyModule`, `DashboardModule`, and the existing `PrismaModule`. Ensure guards are applied per-controller (NOT a global `APP_GUARD`).

- [ ] **Step 4: Write an app-level e2e smoke test** that boots the whole `AppModule` and hits one endpoint from each module (health, signup→me, machines list, projects list, conflicts, notifications, dashboard metrics) to prove wiring + no DI errors.

- [ ] **Step 5: Full verify.** Run `pnpm --filter @synchub/hub-api test` (all suites green), `pnpm --filter @synchub/hub-api build`, then the whole monorepo `pnpm lint && pnpm build && pnpm test`. Confirm legacy untouched: `git status --porcelain hub/ agent/` empty.

- [ ] **Step 6: Commit** `feat(hub-api): wire Phase-2a modules + session sweep + app smoke test`.

---

## Self-Review (author checklist — completed)
- **Spec coverage:** every Phase-2a bullet from design §8 mapped — bootstrap/guards/crypto/errors (Tasks 1,2,4), users (5), machines+pairing (6), projects+mappings (7), NotifyService core + notifications (8), conflicts list (9), dashboard (10), session-expiry migration+sweep (3,4,11). `sync-now` + conflict-resolve explicitly deferred to 2b/2c (Task 7 note).
- **Guards per-controller, `pair/redeem` guardless** (Tasks 4,6) — matches §I1.
- **No placeholders in contracts:** DTO shapes enumerated (Task 3); port logic cites exact legacy files. Implementers MUST read the cited legacy source for query-level fidelity (this is a faithful port, so the legacy code is the spec for SQL-level behavior).
- **Int↔boolean mapping** called out wherever notify flags / `read` / `auto_merged` cross the API boundary.
- **Deferred correctly:** relay store, merge engine, agent endpoints, realtime WS, webhook/WS notify layer, SSRF guard → Phase 2b/2c.
