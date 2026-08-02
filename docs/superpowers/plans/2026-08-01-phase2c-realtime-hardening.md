# Phase 2c: Realtime + Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish Phase 2 by making the Hub **fully realtime** and closing the security hardening backlog. Implement the real `RealtimeGateway` (raw `ws` on the HTTP server, `/ws/agent` + `/ws/user`, query-token auth, live presence + heartbeat), replace the no-op `RealtimePort`, fill the `NotifyService` 2c hooks (live WS push + SSRF-guarded webhook), emit `sync-progress`/`sync-complete` from the push path, and land the deferred hardening (pairing-code race, duplicate-open-conflict guard, `last_ip` verification).

**Architecture:** A `RealtimeGateway` obtains the underlying HTTP server via `HttpAdapterHost` in `onModuleInit`, attaches a `ws.WebSocketServer({ noServer: true })`, and routes `upgrade` by path + `?token=` (machine token → agent channel; session token → user channel) — mirroring legacy `hub/src/lib/realtime.js`. It implements `RealtimePort` (so the sync engine's existing emit calls light up) plus browser-directed presence/progress/complete + `pushNotification`. The `RealtimeModule` swaps its provider from `NoopRealtime` to `RealtimeGateway`. `NotifyService` gains its WS + webhook layer behind the same `notify()` signature.

**Tech Stack:** NestJS 10, `ws` (add to hub-api deps), Prisma, zod, Vitest + a real `ws` client in tests, `@synchub/shared` WS message schemas (already defined in Phase 1: `presence`, `sync-progress`, `sync-complete`, `conflict`, `changed`, `sync-trigger`, `welcome`, `notification`).

**Legacy source of truth:** `hub/src/lib/realtime.js` (the whole gateway: registries, upgrade auth, welcome, presence-via-connection, fan-out, triggerSync, pushNotification), `hub/src/lib/notify.js` (webhook fire), `hub/src/routes/agent.js`/`projects.js` (where fan-out is triggered — already ported as `realtime.notifyProjectChanged` calls). Design spec §2.1 + §6 + §7.

**Conventions:** Windows PowerShell (`A && B` → `A; if ($?) { B }`); don't touch legacy `hub/`/`agent/`; `.js` import extensions; commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer; keep `pnpm --filter @synchub/hub-api test` green.

**Shared WS contract (already in `@synchub/shared`):** browser-directed `presence {machineId,status,lastSeenAt}`, `sync-progress {projectId,machineId,filename?,completed,total,phase}`, `sync-complete {projectId,machineId?,at}`, `conflict {projectId,filename,conflictId}`, `changed {projectId,filename,hash}`, `notification {notification}`; agent-directed `changed`, `sync-trigger {projectId}`, `welcome`. Use these exact shapes.

---

## File Structure (Phase 2c)

```
apps/hub-api/package.json                     # add "ws" + "@types/ws"
apps/hub-api/src/realtime/
├── realtime.gateway.ts                        # raw ws server, upgrade auth, registries, heartbeat, presence, implements RealtimePort
├── realtime.module.ts                         # MODIFY: provide RealtimeGateway for REALTIME_PORT (drop NoopRealtime default)
└── realtime.port.ts                           # (exists) add pushNotification(userId, notification) to the interface
apps/hub-api/src/notify/notify.service.ts      # MODIFY: fill 2c hooks — WS push + SSRF-guarded webhook
apps/hub-api/src/common/net/ssrf.ts            # isPublicHttpUrl() guard + tests
apps/hub-api/src/sync/sync.service.ts          # MODIFY: emit sync-progress/sync-complete around push
apps/hub-api/src/machines/machines.service.ts  # MODIFY: pairing-code redeem CAS (race fix)
apps/hub-api/prisma/schema.prisma              # MODIFY: partial unique index on open conflicts (migration)
```

---

## Task 1: RealtimeGateway — connections, auth, presence, heartbeat

**Files:** add `ws` + `@types/ws` to `apps/hub-api/package.json`; create `apps/hub-api/src/realtime/realtime.gateway.ts`; modify `realtime.port.ts` (add `pushNotification`) + `realtime.module.ts`. Test: `apps/hub-api/test/realtime.e2e.test.ts`.

- [ ] **Step 1: Add deps** `ws@^8.18.0`, `@types/ws@^8.5.13` to hub-api; `pnpm --filter @synchub/hub-api install`.
- [ ] **Step 2: Extend `RealtimePort`** (`realtime.port.ts`): add `pushNotification(userId: number, notification: { type: string; title: string; body?: string | null }): void`. Keep the existing methods.
- [ ] **Step 3: Failing e2e** `realtime.e2e.test.ts` — boot the full app on a real port (use `app.listen(0)` to get an ephemeral port, or `await app.getHttpServer().listen(0)`; read the port). Connect a real `ws` client to `ws://127.0.0.1:<port>/ws/user?token=<sessionToken>` (signup to get a token) and to `/ws/agent?token=<machineToken>` (pair a machine). Assert: user socket receives a `welcome`; agent socket receives a `welcome`; connecting the agent flips `machine.status` to `online` in the DB AND the user's socket receives a `presence {machineId,status:"online"}` message; closing the agent socket flips status `offline` and the user receives `presence {status:"offline"}`; a bad token → the upgrade is rejected (socket closes/errizes). Run → FAIL.
- [ ] **Step 4: Implement `RealtimeGateway`** (`@Injectable()`, `implements OnModuleInit, RealtimePort`; inject `HttpAdapterHost`, `PrismaService`):
  - `onModuleInit()`: `const server = this.adapterHost.httpAdapter.getHttpServer(); this.wss = new WebSocketServer({ noServer: true }); server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));`
  - `handleUpgrade`: parse `new URL(req.url, "http://x")`; `token = url.searchParams.get("token")`. If `pathname === "/ws/agent"`: look up `machine = prisma.machine.findUnique({where:{token}})` (await — handleUpgrade can be async); if none → `socket.destroy()`. Else `wss.handleUpgrade(...)` → `onAgent(ws, machine)`. If `/ws/user`: resolve session token → user (findUnique session include user, reject if expired/null like the guard); none → destroy; else `onUser(ws, user)`. Else destroy.
  - Registries: `agentsByMachine = new Map<number, Set<ws>>`, `usersByUser = new Map<number, Set<ws>>`. Helpers `add/remove/sendTo(set, obj)` (JSON.stringify, only OPEN sockets).
  - `onAgent(ws, machine)`: add to registry; `setMachineStatus(machine.id, "online")` (update DB); `broadcastPresence(machine.user_id, {machineId:machine.id, status:"online", lastSeenAt: <iso>})`; send `{type:"welcome", machineId}`. On `close`: remove; if no sockets left for the machine → `setMachineStatus(offline)` + `broadcastPresence(offline)`.
  - `onUser(ws, user)`: add; send `{type:"welcome", userId}`; on close remove.
  - **Heartbeat:** a shared interval (e.g. every 30s) that pings all sockets with a liveness flag (`ws.isAlive`); on `pong` set alive; if a socket didn't pong since the last tick → `ws.terminate()` (which fires its `close` handler → the SAME offline/presence path, M3). Set `isAlive=true` on connect + on `pong`. Clear the interval in `onModuleDestroy`/gateway close.
  - Implement `RealtimePort` methods (see Task 2 for their bodies): for now `broadcastPresence` (used above), and stub `notifyProjectChanged`/`syncProgress`/`syncComplete`/`pushNotification` to route to the right registry (fill fully in Task 2).
- [ ] **Step 5: Swap the provider** in `realtime.module.ts`: `{ provide: REALTIME_PORT, useClass: RealtimeGateway }` (drop `NoopRealtime` — keep the class for reference or delete it). Ensure `RealtimeGateway` is also directly resolvable if needed (provide it as itself too, or just via the token).
- [ ] **Step 6:** Run → PASS. `pnpm --filter @synchub/hub-api build`. Commit `feat(hub-api): RealtimeGateway (ws /ws/agent + /ws/user, presence, heartbeat)`.

---

## Task 2: Realtime fan-out — changed / progress / complete / notification to the right channels

**Files:** finish `realtime.gateway.ts` method bodies. Test: extend `realtime.e2e.test.ts`.

- [ ] **Step 1: Failing e2e additions:** with a user socket + two agent sockets (two machines mapped to one AUTO-mode project): calling the gateway's `notifyProjectChanged(projectId, {filename, hash, excludeMachineId: A})` sends a `changed` to agent B (not A) AND a `changed`/activity message to the user socket; for a non-auto project, agents are NOT notified but the user still is. `syncProgress`/`syncComplete` reach the user socket. `pushNotification` reaches the user socket. (Drive these by calling the gateway methods directly via `app.get(REALTIME_PORT)`, or by triggering a real push over HTTP and asserting the user socket receives `changed`.) Run → FAIL.
- [ ] **Step 2: Implement the bodies:**
  - `notifyProjectChanged(projectId, {filename, hash, excludeMachineId})`: load project (for `user_id` + `sync_mode`). **Agents:** only if `sync_mode==="auto"`, for each machine mapped to the project (except `excludeMachineId`) `sendTo(agentsByMachine.get(mid), {type:"changed", projectId, filename, hash})`. **Browsers:** always `sendTo(usersByUser.get(project.user_id), {type:"changed", projectId, filename, hash})` (fixes the dead client `changed` handler §7.1).
  - `syncProgress(userId, payload)` → `sendTo(usersByUser.get(userId), {type:"sync-progress", ...payload})`.
  - `syncComplete(userId, payload)` → `sendTo(usersByUser.get(userId), {type:"sync-complete", ...payload})`.
  - `pushNotification(userId, notification)` → `sendTo(usersByUser.get(userId), {type:"notification", notification})`.
  - Add a `triggerSync(projectId)` broker method (for the manual-mode `POST /projects/:id/sync-now`, wired in Task 5): `sendTo` all mapped agents `{type:"sync-trigger", projectId}`.
- [ ] **Step 3:** Run → PASS. Build. Commit `feat(hub-api): realtime fan-out (changed/progress/complete/notification)`.

---

## Task 3: NotifyService 2c layer — live WS push + SSRF-guarded webhook

**Files:** create `apps/hub-api/src/common/net/ssrf.ts` + `ssrf.test.ts`; modify `notify.service.ts`. Test: extend `notify.service.test.ts` + an e2e.

- [ ] **Step 1: SSRF guard (TDD).** `ssrf.ts` `export async function assertPublicHttpUrl(raw: string): Promise<void>` — parse URL; allow only `http:`/`https:`; reject if the host resolves to a private/loopback/link-local/ULA range. Use `node:dns` `lookup(host, {all:true})` and check each address against blocked ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10, 0.0.0.0). Reject literal-IP hosts in those ranges too. Throw on violation. `ssrf.test.ts`: `https://example.com` (public — may need to mock dns.lookup to a public IP), `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1`, `ftp://x`, `http://[::1]` all rejected; mock `dns.lookup` so the test is hermetic (don't hit real DNS).
- [ ] **Step 2: Fill `NotifyService` 2c hooks.** After inserting the notification row, replace the `TODO(2c)` markers: (a) `this.realtime.pushNotification(user_id, {type, title, body})` (inject `@Inject(REALTIME_PORT)`); (b) if `user.notify_webhook_url` is set, fire a best-effort webhook: `await assertPublicHttpUrl(url)` (skip on throw — log + don't send), then `fetch(url, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({type,title,body,at:new Date().toISOString()}), signal: AbortSignal.timeout(5000), redirect:"error"})` wrapped in try/catch (swallow — best-effort, matches legacy). Keep `notify()` returning the row; the WS/webhook are side effects.
- [ ] **Step 3:** unit test — notify with a user who has a private webhook URL → no fetch to it (SSRF blocked); a public URL (mock fetch + dns) → fetch called with the right body; WS push invoked. e2e: a `sync`/`conflict` notify reaches a connected user socket as a `notification` message. Run → PASS.
- [ ] **Step 4:** Build. Commit `feat(hub-api): NotifyService live WS push + SSRF-guarded webhook`.

---

## Task 4: Emit sync-progress / sync-complete from the push path

**Files:** modify `sync.service.ts`. Test: extend `sync-push.e2e.test.ts` (or a realtime e2e with an HTTP push + a user socket).

- [ ] **Step 1: Failing e2e:** connect a user socket; perform an HTTP `push` for a mapped project; assert the user socket receives a `sync-complete {projectId, machineId, at}` after the push, and (for a push that transfers) at least one `sync-progress` message. Run → FAIL.
- [ ] **Step 2: Implement.** In `SyncService.push`, on the branches that persist (accepted/merged) — after commit, in addition to `notifyProjectChanged`, emit: `this.realtime.syncProgress(machine.user_id, {projectId, machineId:machine.id, filename, completed:1, total:1, phase:"push"})` then `this.realtime.syncComplete(machine.user_id, {projectId, machineId:machine.id, at:new Date().toISOString()})`. (Single-file push = 1/1; the richer multi-file progress is an agent-driven Phase-4 concern — here we emit per-push completion so the UI updates live.) Keep it fire-and-forget (RealtimePort methods return void).
- [ ] **Step 3:** Run → PASS. Build. Commit `feat(hub-api): emit sync-progress/complete on push`.

---

## Task 5: Hardening — sync-now trigger, pairing-code CAS, duplicate-open-conflict guard, last_ip

**Files:** `projects.controller.ts`/`projects.service.ts` (sync-now), `machines.service.ts` (pairing CAS), `prisma/schema.prisma` (partial unique) + migration, verify `last_ip`. Test: extend the relevant e2e suites.

- [ ] **Step 1: `POST /api/projects/:id/sync-now`** (SessionAuthGuard) — now that realtime exists, wire it: verify project owned (404), record a `sync_now` event, call `realtime.triggerSync(projectId)` (Task 2), return `{status:"triggered"}`. Add the route to ProjectsController; inject `@Inject(REALTIME_PORT)`. Test: owned → 200 + a mapped agent socket receives `sync-trigger`; not owned → 404.
- [ ] **Step 2: Pairing-code redeem CAS (race fix from 2a).** In `MachinesService.redeemPairingCode`, make consumption atomic: instead of findFirst→create→update, create the machine, then `const consumed = await prisma.pairingCode.updateMany({ where: { code, machine_id: null, expires_at: { gt: new Date() } }, data: { machine_id: newMachine.id } })`; if `consumed.count === 0` → the code was already used/expired → delete the just-created machine (or wrap the whole thing in `$transaction` and throw to roll back) and 400. This closes the double-redeem window. Test: two concurrent redeems of the same code via `Promise.all` → exactly one 201, one 400; only one machine created.
- [ ] **Step 3: Duplicate-open-conflict guard.** Add a partial unique index so a file can have at most one OPEN conflict: in `schema.prisma` Prisma doesn't support partial unique indexes directly for SQLite via `@@unique`, so add it via a raw migration — create the migration with `prisma migrate dev --name uniq_open_conflict --create-only`, then edit the migration SQL to `CREATE UNIQUE INDEX "uniq_open_conflict" ON "conflicts"("project_id","filename") WHERE "status" = 'open';`, then `prisma migrate dev` to apply. In `SyncService` push conflict branch, catch a P2002 on this index → treat as "a conflict is already open for this file" and return the existing open conflict's id (409 `{status:"conflict", conflictId}`) instead of creating a duplicate. Test: two conflict-producing pushes to the same file → only ONE open conflict row; both get a 409 with a conflictId.
- [ ] **Step 4: Verify `last_ip`** is persisted on machine create + pair-redeem (should already be from 2a Task 6). If a `touch()`/agent activity path should also update it, leave as-is (out of scope) but confirm the column is populated on create. No code change if already correct — just a test asserting `last_ip` is set after create (with `trust proxy` the test's `req.ip` may be `::1`/`127.0.0.1`, which is fine — assert it's non-null).
- [ ] **Step 5:** Run the relevant suites → PASS. Build. Commit `feat(hub-api): sync-now trigger + pairing CAS + one-open-conflict-per-file + last_ip`.

---

## Task 6: Full verification + final Phase 2 review

- [ ] **Step 1: Full verification** (report ACTUAL output): `pnpm --filter @synchub/hub-api test` (twice — WS tests must be stable, report count); `pnpm --filter @synchub/hub-api build`; monorepo `pnpm lint && pnpm build && pnpm test` (per-package counts); `git status --porcelain hub/ agent/` → EMPTY.
- [ ] **Step 2: Confirm the realtime contract end-to-end:** a short manual/integration check that a push by one machine reaches (a) another agent's socket as `changed` and (b) the user's browser socket as `changed` + `sync-complete`, and that a machine going offline broadcasts `presence`. (Covered by the e2e suites; summarize.)
- [ ] **Step 3: Commit** any final wiring `feat(hub-api): Phase 2c realtime + hardening complete`. Then the orchestrator runs a final holistic Phase-2 (a+b+c) review.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §2.1 + §6 + §7.2/§7.4):** RealtimeGateway raw-ws via HttpAdapterHost (Task 1); presence + heartbeat sharing the close path (Task 1); browser-directed changed/progress/complete/notification (Tasks 2, 4); NotifyService WS push + SSRF-guarded webhook (Task 3); sync-now trigger (Task 5); pairing-code CAS + one-open-conflict guard + last_ip (Task 5). Replaces the no-op RealtimePort so the sync engine's existing emit calls light up.
- **Deferred items now closed:** pairing-code TOCTOU (2a Task 6 note), duplicate-open-conflict (2b final-review note).
- **No placeholders:** each task cites the legacy source + the exact WS message shapes (from `@synchub/shared`) + the audit fix.
- **Testing:** real `ws` client against a listened app for the gateway; hermetic dns/fetch mocks for SSRF; concurrency tests for pairing CAS + one-open-conflict.
- **Out of scope (later phases):** multi-file agent-driven progress granularity (Phase 4 agent), horizontal-scale WS (non-goal), httpOnly cookies (non-goal).
