# Phase 4b: Agent Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the agent actually sync — port the reconcile/watcher/WS logic to TypeScript, wired through a **single serialized SyncQueue** (kills the overlapping-reconcile races), with all the audit fixes: manual-mode respected, reconnect→reconcile catch-up, incremental live-session push, bounded timers, `state.close()` on shutdown. Plus **delete/rename propagation** (a small hub-api addition + a WS `deleted` message + agent tombstones) so deleted files stop resurrecting.

**Architecture:** Everything that mutates sync state runs through `SyncQueue` (serialized, per-project or global). `agent.ts` orchestrates: boot reconcile → start watcher (auto-mode) → connect WS → 30s timer, all enqueuing work. The WS client reconnects with backoff and enqueues a full reconcile on (re)connect. The watcher pushes on change (incremental) and enqueues a delete on unlink.

**Tech Stack:** Node ≥22, TypeScript, `@synchub/shared`, `chokidar@^4`, `ws@^8`, Vitest. Uses Phase-4a modules: `config`, `state` (get/set/del/flush/close), `hasher`, `api` (`createApi` → `Api`, `ApiResult`), `notifier`, `paths`.

**Legacy source (behavior to port + fix):** `agent/src/{agent,reconcile,watcher,ws}.js` (mapped in the Phase-4 agent audit — do NOT modify). Audit bug list §9 (fixes below).

**Server contract (from the map):** agent-facing endpoints unchanged EXCEPT `"sync"`→`"sync-trigger"` WS message. Agent WS handles only `welcome | changed | sync-trigger` (+ the new `deleted` from Task 3). Push response statuses: `accepted|unchanged|merged|behind|conflict(409)`.

**Conventions:** Windows PowerShell; do NOT touch legacy `agent/`; only `apps/agent/` + (Task 3) `packages/shared/` + `apps/hub-api/`; `.js` imports; no Math.random/Date.now in code; commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer; keep `pnpm --filter @synchub/agent test` + `build` green.

---

## Task 1: SyncQueue (serialized work)

**Files:** Create `apps/agent/src/sync-queue.ts`. Test: `apps/agent/src/sync-queue.test.ts`.

Fixes audit #6 (overlapping reconciles) + #17 (stop cancels/drains).

- [ ] **Step 1: Failing test.** A `SyncQueue` that runs enqueued async tasks ONE AT A TIME in order. Assert: two tasks enqueued back-to-back do NOT run concurrently (instrument with a shared "running" flag / a sequence log — the second starts only after the first resolves); a task that throws doesn't break the queue (next task still runs — errors are caught + surfaced via an onError callback/log); **coalescing**: enqueuing the same keyed job (e.g. `reconcile:projectId`) while one is pending/running collapses to a single pending run (so a burst of `changed` events + a 30s tick don't stack up N reconciles) — assert N rapid `enqueue(key, fn)` with the same key result in at most 2 runs (one in-flight + one queued). `drain()`/`close()` waits for the in-flight task and prevents new ones. Run → FAIL.
- [ ] **Step 2: Implement `SyncQueue`.** A class/factory with `enqueue(key: string, task: () => Promise<void>): void` (coalesce by key — if a job with that key is already queued, don't add another; if running, mark it "rerun once" so it runs again after), an internal single-consumer loop (process one at a time), `onError?` for caught task errors, and `close(): Promise<void>` (stop accepting new work, await the in-flight one). Keep it small + deterministic (no timers needed internally; driven by enqueue). No Math.random/Date.now.
- [ ] **Step 3:** Run test → PASS. Build. Commit `feat(agent): serialized SyncQueue (coalescing, error-isolating)`.

---

## Task 2: reconcile.ts (sync_mode-aware, tolerant, delete-aware)

**Files:** Create `apps/agent/src/reconcile.ts`. Test: `apps/agent/src/reconcile.test.ts`.

Port `agent/src/reconcile.js` with fixes: uses the tolerant `Api` (ApiResult — no throw, non-200 skips one file not the batch, audit #8); **respects `sync_mode`** (manual only on explicit trigger, audit #11); async file I/O (audit #15); a **tombstone**-aware pull (don't re-pull a file the agent just deleted, audit #5); returns cleanly so the queue can serialize it.

- [ ] **Step 1: Failing test** (mock `Api` + a temp local dir): 
  - `pushLocal` state machine: `accepted`→`state.set(hash)`; `unchanged`→state.set; `merged`/`behind`→pull the merged content, overwrite local, state.set, notify on merged; `409 conflict`→log + notify "resolve in Hub" + no state change; `unauthorized`→surfaces a re-pair signal; other failure→logged, skipped (no crash).
  - `reconcileProject`: hub-only file → pull+write+state.set; local-only → push (base_hash null); both same hash → state.set only; both differ → push with `state.get` base_hash. A file present in the manifest that the agent has a **tombstone** for → do NOT re-pull (resurrection fix). A manifest fetch failure (ApiResult not ok) → the project is skipped gracefully (no throw, no partial corruption).
  - `reconcileAll`: fetches mappings; **filters by sync_mode** — for a periodic/boot reconcile, `manual` and `stopped` projects are SKIPPED (only `auto`); for a `sync-trigger`-driven reconcile of a specific project, `manual` IS reconciled (pass a flag/param). Async I/O (readdir/readFile via fs/promises).
  Run → FAIL.
- [ ] **Step 2: Implement `reconcile.ts`** — `pushLocal`, `reconcileProject(api, state, tombstones, {projectId, localPath}, opts)`, `reconcileAll(api, state, tombstones, {trigger: "auto"|"manual-project", projectId?}, log, notify)`. Use `fs/promises` for local file I/O. Branch on the `Api` `ApiResult`. `sync_mode` gating: periodic/boot reconcile processes only `auto`; an explicit `sync-trigger` for a project processes it regardless of mode (but still not `stopped`). Tombstones: a small in-memory `Set<string>` of `${projectId}/${filename}` recently deleted locally — skip re-pulling those (cleared when the manifest no longer lists them, i.e. the server has processed the delete). Never throw out — collect/skip per-file errors.
- [ ] **Step 3:** Run test → PASS. Build. Commit `feat(agent): reconcile (sync_mode-aware, tolerant, tombstone-safe)`.

---

## Task 3: Delete propagation — shared + hub-api (backend half)

**Files:** `packages/shared/src/{ws,sync}.ts` (+ index); `apps/hub-api/src/sync/{sync.controller,sync.service}.ts`; `apps/hub-api/src/realtime/{realtime.port,realtime.gateway}.ts`. Tests: hub-api e2e + shared round-trip.

Add the server side so a deleted file is removed + fanned out (fixes resurrection at the source).

- [ ] **Step 1: shared** — add to `packages/shared/src/ws.ts` a `WsDeleted = z.object({ type: z.literal("deleted"), projectId, filename })` and include it in the `WsMessage` union. Add to `sync.ts` a `DeleteRequest = z.object({ filename: z.string() })`. Round-trip tests. Rebuild shared.
- [ ] **Step 2: hub-api** — `POST /api/agent/delete/:projectId` (MachineAuthGuard, requireMapping, ParseIntPipe) in `SyncController` → `SyncService.deleteFile(machine, projectId, filename)`: validate `isSafeFilename`; in a `$transaction` remove the `file_state` row if present + record a `delete` event; (the blob is reclaimed by the existing orphan GC — no explicit blob delete needed, or remove it best-effort). After commit: `realtime.notifyDeleted(project.user_id, projectId, filename, excludeMachineId)` — a new `RealtimePort` method that fans a `deleted` message to other mapped agents (auto mode) + the user's browsers (like `notifyProjectChanged`). Idempotent: deleting an already-absent file → 200 (no-op), not an error. Return `{ status: "deleted" }`.
- [ ] **Step 3: RealtimePort + gateway** — add `notifyDeleted(userId, projectId, filename, excludeMachineId?)` to the `RealtimePort` interface + `NoopRealtime` + implement in `RealtimeGateway` (mirror `fanOutChanged`: agents get `deleted` only in auto mode, browsers always). Wire the browser side: the frontend's RealtimeProvider already invalidates on `changed`; add a `deleted` case (invalidate the same project/dashboard keys) — small hub-web change in `realtime-provider.tsx` (add the case; the shared WsMessage union now includes it, exhaustiveness guard forces it).
- [ ] **Step 4: tests** — hub-api e2e: pair a machine + mapping + seed a file_state; `POST /api/agent/delete/:projectId {filename}` → 200, file_state gone, a `delete` event; delete a non-existent file → 200 no-op; unmapped project → 404. A gateway test: a `deleted` fan-out reaches another agent socket (auto) + a user socket. Run hub-api tests twice (WS stable). hub-web: the realtime `deleted` case invalidates the right keys (extend `realtime.test.tsx`).
- [ ] **Step 5:** Verify `pnpm --filter @synchub/hub-api test` (twice), `@synchub/shared test`, `@synchub/hub-web test`, all builds. Commit `feat(hub-api,shared,hub-web): file delete endpoint + WsDeleted fan-out`.

---

## Task 4: watcher.ts (incremental, unlink)

**Files:** Create `apps/agent/src/watcher.ts`. Test: `apps/agent/src/watcher.test.ts`.

Port `agent/src/watcher.js` with fixes: incremental/faster live push (audit #7 — reduce/remove the 500ms awaitWriteFinish stall for append-only files), an **unlink** handler that enqueues a delete (audit #5/#12), bounded debounce-timer map (audit #13, delete entries when they fire), and it enqueues work onto the SyncQueue rather than pushing directly.

- [ ] **Step 1: Failing test** (mock chokidar OR use a real temp dir + a real chokidar with a short debounce; prefer injecting the change/unlink callbacks so it's deterministic without real FS timing — design `watchProjects` to accept an injectable watcher-factory, OR test the debounce/dispatch logic in isolation). Assert: an `add`/`change` on a `.jsonl` enqueues a push job (via the SyncQueue) after the debounce; rapid changes to the same file coalesce (one push, timer entry removed after firing — no unbounded map growth); an `unlink` enqueues a delete job; only `auto`-mode mappings are watched; `.close()` closes all watchers. Run → FAIL.
- [ ] **Step 2: Implement `watchProjects(queue, api, state, tombstones, mappings, {log, notify, watcherFactory?})`** — one chokidar watch per `auto` mapping (`ignoreInitial`, `depth:0`; tune `awaitWriteFinish` to a short stability window — e.g. 300ms — or drop it and rely on a small debounce, so live-appending sessions push promptly; document the choice). `onChange(path)`: debounce per path in a Map, and **delete the map entry inside the fired callback** (bounded); on fire, read the file async + `queue.enqueue(\`push:\${projectId}/\${filename}\`, () => pushLocal(...))`. `onUnlink(path)`: `queue.enqueue(\`delete:\${projectId}/\${filename}\`, () => api.deleteFile(...) then state.del + add a tombstone)`. `close()` closes all + clears timers. Return `{ close }`.
- [ ] **Step 3:** Run test → PASS. Build. Commit `feat(agent): watcher (incremental push, unlink→delete, bounded timers)`.

---

## Task 5: ws.ts + agent.ts (orchestration through the queue)

**Files:** Create `apps/agent/src/ws.ts`, `apps/agent/src/agent.ts`; wire `cmdRun` in `cli.ts` to `runAgent`. Test: `apps/agent/src/{ws,agent}.test.ts`.

Port `agent/src/{ws,agent}.js` with fixes: WS backoff reconnect (from legacy) + **reconnect→enqueue full reconcile** (audit #9), handle `sync-trigger` (renamed) + `changed` + `deleted`, and orchestrate everything through the SyncQueue; `SIGINT`/`SIGTERM` → `state.close()` + queue.close() + ws.close() (the 4a carry-forward). Add `api.deleteFile(projectId, filename)` to the Phase-4a api client (it wasn't there — add it now, tolerant like the others).

- [ ] **Step 1: add `deleteFile` to `api.ts`** — `POST /api/agent/delete/:projectId {filename}` → `ApiResult<{status:string}>` (accept 200), guarded like the others.
- [ ] **Step 2: Failing test** `ws.test.ts` (fake WebSocket, fake timers): connects to `ws(s)://host/ws/agent?token=`; backoff reconnect on close (exponential, capped, reset on open); on (re)open, calls the provided `onReconnect`/enqueues a reconcile; parses messages (guarded) and dispatches `changed`/`sync-trigger`/`deleted`/`welcome`; intentional `close()` doesn't reconnect. `agent.test.ts` (mock api/state/watcher/ws or use the injectable seams): `runAgent` does a boot reconcile (auto only), starts the watcher, connects WS; a `changed` message → enqueues a pull; a `sync-trigger` → enqueues a reconcile of that project (incl. manual mode); a `deleted` → removes the local file + state; a WS reconnect → enqueues a full reconcile; `stop()` closes ws + watcher + queue + `state.close()` (flushes). Run → FAIL.
- [ ] **Step 3: Implement `ws.ts`** — `connectWs({hubUrl, machineToken}, {onMessage, onOpen, log})` using the `ws` package, backoff reconnect (base 1s, cap 30s, reset on stable open), guarded JSON parse, `onOpen` fires on every (re)connect, `close()` suppresses reconnect. **Implement `agent.ts`** — `runAgent({config, statePath}, log?)`: create `api`, `state`, `notifier`, `tombstones = new Set()`, `queue = new SyncQueue({onError})`. Boot: `queue.enqueue("reconcile:all", () => reconcileAll(..., {trigger:"auto"}))`. Start `watchProjects(queue, ...)`. Connect WS: `onMessage` switch → `changed`: enqueue a pull of that file; `sync-trigger`: enqueue `reconcileProject(...)` for that project (manual allowed); `deleted`: remove local file + `state.del` + tombstone; `welcome`: ignore. `onOpen`: enqueue `reconcile:all` (reconnect catch-up). A 30s timer (unref) enqueues `reconcile:all` + refreshes the watcher set if mappings changed (port the legacy mapping-diff logic). Return `stop()` that clears the timer, closes ws + watcher + `queue.close()` + `state.close()`. Handle an `unauthorized` ApiResult anywhere by logging a clear "machine token revoked — re-pair" (audit #10). **Wire `cli.ts` `cmdRun`** to call `runAgent` + SIGINT/SIGTERM → `stop()`.
- [ ] **Step 4:** Run tests → PASS. Build. Commit `feat(agent): ws client + agent orchestration (queue-serialized, reconnect-reconcile, graceful stop)`.

---

## Task 6: Integration test + verify + review

**Files:** `apps/agent/test/agent.e2e.test.ts` (or `src/`). 

- [ ] **Step 1: Integration test** — boot an in-process hub-api (`Test.createTestingModule([AppModule])` + `app.listen(0)`, temp DATABASE_URL + RELAY_STORE_DIR) OR reuse a lightweight harness; pair a machine via the real `pairRedeem`; create a project + mapping (via the hub-api API with a session); then drive the agent's `runAgent` against it in a temp local dir and assert an end-to-end flow: a local file write → appears on the hub (manifest/pull); a hub-side change → the agent pulls it live via WS `changed`; a local delete → the file is removed hub-side (no resurrection on the next reconcile); a `sync-trigger` reconciles a manual project. Keep it deterministic (drive via the queue/explicit flushes where possible; generous timeouts for the real WS/HTTP). If a full in-process hub-api e2e is too heavy/flaky, do a focused integration of `runAgent` against a mocked-but-realistic api + a fake ws, and document that a real end-to-end (like the legacy `e2e-docker.mjs`) should run in CI.
- [ ] **Step 2: Verify** — `pnpm --filter @synchub/agent test` (all pass, twice if WS/timers involved), `pnpm --filter @synchub/agent build`, monorepo `pnpm lint && pnpm build && pnpm test` (report per-package). Legacy `agent/` untouched.
- [ ] **Step 3:** Commit. Orchestrator runs a Phase-4b review.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §2/§3/§4/§6-4b):** SyncQueue serialization (Task 1 — audit #6,17); reconcile sync_mode-aware + tolerant + tombstone (Task 2 — audit #8,11,15,5); delete propagation server+contract+browser (Task 3 — audit #5,12); watcher incremental + unlink + bounded timers (Task 4 — audit #7,13,5); ws reconnect→reconcile + agent orchestration + graceful stop + token-revoked (Task 5 — audit #9,10, +4a carry-forward state.close); integration (Task 6).
- **Deferred to 4c:** single-binary (SEA) + install scripts + OS service + delete legacy agent/.
- **Seams:** everything mutating goes through the SyncQueue; `Api` ApiResult drives reconcile branching; `state.close()` on shutdown; tombstones shared between watcher + reconcile + ws.
