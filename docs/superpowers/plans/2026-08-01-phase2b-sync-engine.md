# Phase 2b: Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port the legacy Hub's agent-facing sync engine to `apps/hub-api` (NestJS): `MergeService` (append-only auto-merge), a **content-addressed** `RelayStoreService` (crash-safe, replaces the naïve flat-file store), the four agent endpoints (`mappings`/`manifest`/`pull`/`push`), and conflict resolution — with the audit fixes: `base_hash` becomes advisory-only (no data-loss overwrite), writes are content-addressed + transactional, the candidate filename uses the full hash, and auto-merges log via `events` (no fabricated conflict row).

**Architecture:** A new `sync/` module holds `MergeService`, `RelayStoreService`, `SyncService` (the push/pull/manifest logic), and the agent controller (MachineAuthGuard). Conflict-resolve stays on `ProjectsController` at the legacy nested path, delegating to `ConflictsService.resolve`. Realtime fan-out (presence/progress/changed) is Phase 2c — 2b depends on a `RealtimePort` injection token with a **no-op default**, so `SyncService` can emit without the real gateway existing yet.

**Tech Stack:** NestJS 10, Prisma 6 (SQLite), zod (`@synchub/shared`), Vitest + supertest + SWC, `@nestjs/schedule` (already present, for orphan GC).

**Legacy source of truth (READ — port behavior exactly):**
- `hub/src/routes/agent.js` (the push decision tree, manifest/pull/mappings), `hub/src/lib/merge.js` (autoMerge), `hub/src/lib/relayStore.js` (flat store — REPLACED by content-addressed here), `hub/src/routes/projects.js` (conflict-resolve handler), `hub/src/models/{fileState,conflicts,mappings,events}.js`.
- Phase 2 design spec §4/§6 + audit §7.2/§7.3/§7.4: `docs/superpowers/specs/2026-08-01-phase2-backend-design.md`.
- Existing hub-api: `apps/hub-api/src/{prisma,common,projects,conflicts,notify}` (reuse `PrismaService`, `MachineAuthGuard`, `NotifyService`, `CryptoService.hashContent`).

**Conventions:** Windows PowerShell (`A && B` → `A; if ($?) { B }`); don't touch legacy `hub/`/`agent/`; `.js` import extensions; commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer; keep `pnpm --filter @synchub/hub-api test` green after each task.

**Data-shape reference (from the mapped legacy surface):**
- `POST /api/agent/push/:projectId` body `{ filename, content, base_hash?: string|null }` → 200 `{status:"unchanged"|"behind"|"accepted"|"merged", hash}` or 409 `{status:"conflict", conflictId}`.
- `GET /api/agent/manifest/:projectId` → `[{filename, hash, size, updated_at}]`.
- `GET /api/agent/pull/:projectId/:filename` → raw `application/x-ndjson`.
- `GET /api/agent/mappings` → `[{project_id, machine_id, local_path, alias, sync_mode}]` (+ touch machine online).
- `POST /api/projects/:id/conflicts/:conflictId/resolve` body `{choice:"candidate"|"canonical"}` → `{status:"resolved", choice}`.

---

## File Structure (Phase 2b)

```
packages/shared/src/api.ts            # ADD: PushRequest is already in sync.ts; add ResolveConflictRequest, ManifestEntry re-use
apps/hub-api/src/
├── realtime/realtime.port.ts         # RealtimePort interface + REALTIME_PORT token + NoopRealtime (2c replaces impl)
├── sync/
│   ├── merge.service.ts              # autoMerge (verbatim from lib/merge.js)
│   ├── merge.service.test.ts
│   ├── relay-store.service.ts        # content-addressed blob store (write-once, fsync+rename, GC)
│   ├── relay-store.service.test.ts
│   ├── sync.service.ts               # push decision tree + manifest/pull/mappings logic
│   ├── sync.controller.ts            # @Controller("agent") MachineAuthGuard: mappings/manifest/pull/push
│   ├── relay-gc.service.ts           # @Cron orphan-blob sweep
│   └── sync.module.ts
├── conflicts/conflicts.service.ts    # ADD: resolve(userId, projectId, conflictId, choice)
└── projects/projects.controller.ts   # ADD: POST /:id/conflicts/:conflictId/resolve (delegates to ConflictsService)
```

---

## Task 1: RealtimePort (no-op seam for 2c)

**Files:** Create `apps/hub-api/src/realtime/realtime.port.ts`, `realtime.module.ts`. Test: none (trivial) — covered via sync tests.

- [ ] **Step 1:** Create `realtime.port.ts` exporting: an injection token `export const REALTIME_PORT = Symbol("REALTIME_PORT");`, an `interface RealtimePort` with methods the sync engine needs (all fire-and-forget, return void): `notifyProjectChanged(projectId: number, p: { filename: string; hash: string; excludeMachineId?: number }): void`, `syncProgress(userId: number, p: {...}): void`, `syncComplete(userId: number, p: {...}): void`, `broadcastPresence(userId: number, p: {...}): void`. And a `@Injectable() class NoopRealtime implements RealtimePort` whose methods are empty bodies. (Phase 2c swaps the provider for the real gateway; signatures are frozen here.)
- [ ] **Step 2:** Create `realtime.module.ts` — `@Global() @Module` providing `{ provide: REALTIME_PORT, useClass: NoopRealtime }`, exporting `REALTIME_PORT`. Register in `app.module.ts`.
- [ ] **Step 3:** `pnpm --filter @synchub/hub-api build` compiles. Commit `feat(hub-api): RealtimePort seam (no-op until 2c)`.

---

## Task 2: MergeService (port autoMerge + tests first)

**Files:** Create `apps/hub-api/src/sync/merge.service.ts`, `merge.service.test.ts`.

- [ ] **Step 1: Port the legacy merge tests FIRST.** Read `hub/test/merge.test.js` (4 cases) and re-express them as Vitest tests in `merge.service.test.ts` against a `new MergeService()`. Then ADD cases: pure-append on both sides → `merged` with timestamp order; incoming is prefix of canonical → `behind`; canonical is prefix of incoming → `forward`; a tail line that isn't valid JSON → `conflict` (merged null); identical content → handled (behind, since bTail empty). Run → FAIL (no service yet).
- [ ] **Step 2: Implement `MergeService.autoMerge(canonical: string, incoming: string)`** porting `hub/src/lib/merge.js` VERBATIM (as methods): `splitLines`, `longestCommonPrefix`, `parseLine`, and `autoMerge` returning `{ kind: "behind"|"forward"|"merged"|"conflict", merged: string|null }`. Keep the exact algorithm: LCP → if bTail empty `behind`; if aTail empty `forward`; else union of tails deduped by exact string, JSON.parse each (any failure → `conflict`), stable-sort by `.timestamp`, join with trailing `\n` → `merged`.
- [ ] **Step 3:** Run tests → PASS. Commit `feat(hub-api): MergeService (autoMerge ported from legacy) + tests`.

---

## Task 3: Content-addressed RelayStoreService

**Files:** Create `apps/hub-api/src/sync/relay-store.service.ts`, `relay-store.service.test.ts`.

Design (audit §7.3 fix): blobs are stored **write-once at a path derived from their sha-256**, not by filename. `file_state.hash` / `conflict.candidate_hash` are the pointers. A crash before the DB commit leaves an orphan blob; the DB still points at the old blob. Base dir from `process.env.RELAY_STORE_DIR` (default `<hub-api>/data/relay-store`), namespaced per user for easy cleanup: `<baseDir>/<userId>/blobs/<hash>`.

- [ ] **Step 1: Failing test** `relay-store.service.test.ts` (uses a temp dir via `RELAY_STORE_DIR`): `writeBlob(userId, content)` returns the sha-256 and creates a file; `readBlob(userId, hash)` returns the content, `null` if absent; writing the SAME content twice is idempotent (one file, no error); `hasBlob`; `removeBlob`; a crash-sim (write blob, DON'T record a pointer) leaves an orphan that `listBlobHashes(userId)` includes; `gcOrphans(userId, referencedHashes: Set<string>)` deletes blobs not in the referenced set and returns the count deleted. Run → FAIL.
- [ ] **Step 2: Implement `RelayStoreService`** (inject nothing; read `RELAY_STORE_DIR` in the constructor). `writeBlob(userId, content)`: compute `hash = sha256(content)`; path = `blobPath(userId, hash)`; if it already exists, return hash (idempotent); else write to a temp file in the same dir (`<hash>.tmp.<rand>` — derive rand from content+counter, NOT Math.random, to stay deterministic under the no-`Math.random` rule; or use `crypto.randomBytes`), `fs.fsync` the file, `fs.rename` to the final path, and `fsync` the parent directory (best-effort; wrap the dir-fsync in try/catch since it's not supported on all platforms). Return hash. `readBlob`, `hasBlob`, `removeBlob`, `listBlobHashes(userId)` (readdir), `gcOrphans(userId, referenced)`. Use `node:crypto` `createHash("sha256")` for hashing (or reuse `CryptoService.hashContent` — but keep this service dependency-light; hashing inline is fine and matches legacy).
- [ ] **Step 3:** Run tests → PASS. Commit `feat(hub-api): content-addressed RelayStoreService (crash-safe blobs + GC)`.

---

## Task 4: Sync read endpoints (mappings, manifest, pull)

**Files:** Create `apps/hub-api/src/sync/sync.service.ts` (partial), `sync.controller.ts` (partial), `sync.module.ts`. Test: `apps/hub-api/test/sync-read.e2e.test.ts`.

Port `hub/src/routes/agent.js` read routes. All under `@Controller("agent")` (→ `/api/agent/*`) with `MachineAuthGuard` + `@CurrentMachine()`. `requireMapping` = the machine must have a `mapping` row for the project (else 404 `{error:"not mapped to project"}`).

- [ ] **Step 1: Failing e2e** `sync-read.e2e.test.ts`: pair a machine (or seed a machine + mapping via Prisma), then with `X-Machine-Token`: `GET /api/agent/mappings` → the machine's mappings (`{project_id, machine_id, local_path, alias, sync_mode}`) and the machine's `status` becomes `online`/`last_seen_at` bumped; `GET /api/agent/manifest/:projectId` → file_state rows (seed some) or 404 if not mapped; `GET /api/agent/pull/:projectId/:filename` → the blob content (seed a file_state + its blob via RelayStoreService) with content-type `application/x-ndjson`, 404 if unmapped/missing, 400 if unsafe filename. Unauthenticated (no machine token) → 401. Run → FAIL.
- [ ] **Step 2: Implement** `SyncService` methods: `listMappings(machine)` (Prisma `mapping.findMany` for the machine, join project alias+sync_mode; also `touch(machine)` → update status online + last_seen_at), `manifest(machine, projectId)` (requireMapping then `fileState.findMany` → `{filename,hash,size,updated_at}`), `pull(machine, projectId, filename)` (requireMapping, validate `isSafeFilename`, look up `fileState` for the hash, `relayStore.readBlob(machine.user_id, hash)`; 404 if missing). Add an `isSafeFilename` helper (port from `relayStore.js`: `/^[A-Za-z0-9._-]+$/`, len 1..255). `SyncController` wires the three GETs with `MachineAuthGuard`. Send pull with `res.type("application/x-ndjson")`.
- [ ] **Step 3:** Run → PASS. Commit `feat(hub-api): agent read endpoints (mappings/manifest/pull)`.

---

## Task 5: Push decision tree (the core)

**Files:** Extend `sync.service.ts` (push) + `sync.controller.ts` (POST push). Test: `apps/hub-api/test/sync-push.e2e.test.ts`.

Port `hub/src/routes/agent.js` `POST /push/:projectId` EXACTLY, with the audit fixes. Use `PushRequest` from `@synchub/shared` (`{filename, content, base_hash?}`). Wrap the canonical mutation (blob write already durable + `file_state` upsert + event + any conflict row) in a Prisma `$transaction`.

**Decision tree (with fixes):**
1. `newHash = sha256(content)`; `current = fileState.get(projectId, filename)`.
2. **unchanged:** `current && current.hash === newHash` → touch, `200 {status:"unchanged", hash:newHash}`.
3. **`current` exists (divergence or clean update) — ALWAYS autoMerge (base_hash advisory-only, §7.2 fix):** read canonical content via `relayStore.readBlob(userId, current.hash)` (fallback `""`); `m = merge.autoMerge(canonical, content)`.
   - `behind` → touch, `200 {status:"behind", hash:current.hash}`.
   - `forward` or `merged` → `finalContent=m.merged`; `finalHash=sha256(finalContent)`; `finalSize=byteLength`; **in a `$transaction`**: `relayStore.writeBlob(userId, finalContent)` (durable first, outside/before tx is fine since it's content-addressed and idempotent), then `fileState.upsert(projectId, filename, finalHash, finalSize, machineId)`, `events.record({type: m.kind==="merged"?"auto_merge":"push", ..., latency_ms})`. If `merged`: also `notify.notify({user_id, type:"sync", title:\`Auto-merged \${filename}\`, ...})` — **do NOT** fabricate+resolve a conflict row (§7.4 fix; the legacy `conflicts.open+resolve+auto_merged=1` is dropped — the `auto_merge` event is the audit trail). After commit: `realtime.notifyProjectChanged(projectId, {filename, hash:finalHash, excludeMachineId:machineId})`; touch; `200 {status: m.kind==="merged"?"merged":"accepted", hash:finalHash}`.
   - `conflict` → canonical untouched. `candidateHash=newHash`; `relayStore.writeBlob(userId, content)` (stores the candidate blob keyed by its full hash — §7.4: full hash, not sliced); `conflicts.open(projectId, filename, machineId, candidateHash)`; `notify.notify({type:"conflict", title:\`Conflict in \${filename}\`, ...})`; `events.record({type:"conflict", filename, bytes})`; touch; **409** `{status:"conflict", conflictId}`.
4. **first sync (no `current`) or forward-update fallthrough:** `relayStore.writeBlob(userId, content)`; in `$transaction`: `fileState.upsert(..., newHash, size, machineId)`, `events.record({type:"push", latency_ms})`; after: `realtime.notifyProjectChanged(...)`; touch; `200 {status:"accepted", hash:newHash}`.

Note the candidate no longer needs a separate filename — it's a content-addressed blob keyed by `candidate_hash`; `conflict.candidate_hash` IS the pointer. (When resolving in Task 6, read the candidate blob by `candidate_hash`.)

- [ ] **Step 1: Failing e2e** `sync-push.e2e.test.ts` exercising every branch: first push (accepted, file_state created, blob stored, event `push`); identical re-push (unchanged); clean append with correct base_hash (accepted, `forward`); a divergent append from a stale base that append-merges cleanly (merged — assert `status:"merged"`, canonical now contains union, an `auto_merge` event exists, a `sync` notification row exists, and NO conflict row was created); a divergence with a non-JSON tail line (409 conflict, conflict row open, candidate blob stored by its hash, `conflict` notification + event); **base_hash data-loss guard:** push with a LYING `base_hash === current.hash` but stale content that would drop canonical lines → assert canonical lines are NOT lost (the merge preserves them / or returns behind), i.e. a wrong base_hash cannot overwrite. Run → FAIL.
- [ ] **Step 2: Implement** `SyncService.push(machine, projectId, {filename, content, base_hash})` per the tree above; `requireMapping` first (404). Add the POST route to `SyncController`. Use `Buffer.byteLength(content, "utf8")` for size; measure `latency_ms` from a start timestamp.
- [ ] **Step 3:** Run → PASS. Commit `feat(hub-api): push decision tree (base_hash advisory + content-addressed + transactional)`.

---

## Task 6: Conflict resolution (legacy nested path)

**Files:** Extend `conflicts/conflicts.service.ts` (`resolve`) + add the route to `projects/projects.controller.ts`. Test: `apps/hub-api/test/conflict-resolve.e2e.test.ts`. Add `ResolveConflictRequest` to `@synchub/shared`.

Port `hub/src/routes/projects.js` resolve handler. Route: `POST /api/projects/:id/conflicts/:conflictId/resolve` (SessionAuthGuard), body `{choice:"candidate"|"canonical"}` (default "candidate" if not exactly "canonical").

- [ ] **Step 1: Add DTO** `ResolveConflictRequest = z.object({ choice: z.enum(["candidate","canonical"]).optional() })` to `packages/shared/src/api.ts`; rebuild shared.
- [ ] **Step 2: Failing e2e** `conflict-resolve.e2e.test.ts`: seed a project + an open conflict + its candidate blob (write via RelayStoreService keyed by `candidate_hash`) + a canonical file_state. Resolve with `choice:"candidate"` → canonical file_state now has `candidate_hash`, the candidate content is promoted, conflict `status:"resolved"`, a `conflict_resolved` event, a `sync` notification; resolve with `choice:"canonical"` → canonical unchanged, conflict resolved, event recorded. 404 if project/conflict not owned or not open. Run → FAIL.
- [ ] **Step 3: Implement `ConflictsService.resolve(userId, projectId, conflictId, choice)`**: verify the project is owned (`findOwned`) and the conflict belongs to it and is `status:"open"` (else 404). In a `$transaction`: if `choice==="candidate"`: read candidate blob by `conflict.candidate_hash` (410 if missing), it's already stored content-addressed so no re-write needed — just `fileState.upsert(projectId, filename, candidate_hash, size, conflict.machine_id)` (compute size from the blob), `events.record({type:"conflict_resolved", bytes})`; if `choice==="canonical"`: only `events.record({type:"conflict_resolved"})` (no file_state change). Both: `conflicts.resolve(conflictId)` (status resolved + resolved_at); `notify.notify({type:"sync", title:\`Conflict resolved: \${filename}\`, body:\`Kept the \${choice} version.\`})`. If `candidate`: after commit `realtime.notifyProjectChanged(projectId, {filename, hash:candidate_hash})`. Wire the route on `ProjectsController` (it already has the project ownership context) delegating to `ConflictsService.resolve`; inject `ConflictsService` into the projects module (import ConflictsModule/export the service). Use `ParseIntPipe` on both `:id` and `:conflictId`.
- [ ] **Step 4:** Run → PASS. Commit `feat(hub-api,shared): conflict resolution at legacy nested path`.

---

## Task 7: Orphan-blob GC + wiring + full verification + final review

**Files:** Create `apps/hub-api/src/sync/relay-gc.service.ts`; wire `SyncModule` in `app.module.ts`. Test: `apps/hub-api/test/relay-gc.e2e.test.ts`.

- [ ] **Step 1: Failing test** `relay-gc.e2e.test.ts`: seed, for a user, some blobs referenced by `file_state.hash` and `conflict.candidate_hash`, plus an orphan blob (write a blob with no pointer). Call the GC method; assert the orphan is deleted and referenced blobs survive. Run → FAIL.
- [ ] **Step 2: Implement `RelayGcService`** — a method `gcUser(userId)` that gathers all referenced hashes for the user (`file_state.hash` across the user's projects + `conflict.candidate_hash` for open conflicts) into a `Set`, then calls `relayStore.gcOrphans(userId, referenced)`. Add a `@Cron(CronExpression.EVERY_DAY_AT_1AM)` `sweepAll()` that iterates all users and calls `gcUser`. Inject `PrismaService` + `RelayStoreService`.
- [ ] **Step 3: Wire** `SyncModule` (declares MergeService, RelayStoreService, SyncService, SyncController, RelayGcService; imports what it needs; exports RelayStoreService + ConflictsService usage as needed) into `app.module.ts`. Ensure `ScheduleModule` (already in AppModule) picks up the new cron.
- [ ] **Step 4: Full verification** (report actual output): `pnpm --filter @synchub/hub-api test` (all green, count); `pnpm --filter @synchub/hub-api build`; monorepo `pnpm lint && pnpm build && pnpm test`; `git status --porcelain hub/ agent/` → EMPTY.
- [ ] **Step 5: Commit** `feat(hub-api): orphan-blob GC + wire sync module`.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §4):** MergeService verbatim + tests-first (Task 2); content-addressed crash-safe store + GC (Tasks 3, 7); agent endpoints mappings/manifest/pull/push (Tasks 4, 5); base_hash advisory + always-merge (Task 5); transactional writes (Tasks 5, 6); full-hash candidate + no fabricated conflict row (Task 5, §7.4); conflict-resolve at legacy nested path (Task 6); NotifyService core called, realtime via no-op port (Task 1) until 2c.
- **Deferred to 2c (correctly absent here):** the real WS gateway, presence/progress/sync-complete emission (only the no-op `RealtimePort` is called), the NotifyService WS+webhook layer.
- **No placeholders:** each task cites the exact legacy source to port and the precise decision-tree/branch behavior + the audit fix folded in.
- **Type/naming consistency:** `RealtimePort`/`REALTIME_PORT` used by `SyncService` (Task 1 defines, Task 5 consumes); `MergeService.autoMerge` return `{kind, merged}` consumed by push (Task 5); `RelayStoreService.writeBlob/readBlob/gcOrphans` defined Task 3, consumed Tasks 5/6/7.
