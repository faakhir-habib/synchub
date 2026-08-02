# Phase 4a: Agent Core Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Build the TypeScript agent's foundation in `apps/agent`: `config` + `state` (atomic, crash-safe, guarded), `hasher`, a tolerant `api` client, `notifier`, and the `cli` (`pair` + a stub `run`/`status`, version from package.json). Unit-tested. No live sync yet (that's 4b).

**Architecture:** A lightweight Node/TS CLI (ESM, `"type":"module"`), consuming `@synchub/shared` for wire types. Files are small and single-purpose. All disk writes (config/state) are atomic (temp + fsync + rename) with guarded parsing (corrupt file never crash-loops).

**Tech Stack:** Node ≥22, TypeScript, `@synchub/shared`, Vitest. Runtime deps added as needed (`node-notifier` for 4a; `chokidar`/`ws` in 4b).

**Legacy source of truth (behavior to port, mapped in the Phase-4 agent audit):**
- `agent/src/{config,state,hasher,api,notifier,cli}.js` — port behavior; apply the audit fixes.
- `@synchub/shared/src/{sync,api}.ts` — `AgentMapping`, `PushRequest`, `PushResponse`, `ManifestEntry`, `PairRedeemRequest`, `PairRedeemResponse`.
- Server agent endpoints (contract to speak): `POST /api/agent/pair/redeem`, `GET /api/agent/mappings`, `GET /api/agent/manifest/:projectId`, `GET /api/agent/pull/:projectId/:filename`, `POST /api/agent/push/:projectId` (auth via `X-Machine-Token`).

**Conventions:** Windows PowerShell (`A && B` → `A; if ($?) { B }`); do NOT modify legacy `agent/` or `hub/`-anything; only `apps/agent/`. Local imports use `.js` extensions (NodeNext). Commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Keep `pnpm --filter @synchub/agent test` + `build` green.

**Current state:** `apps/agent` has `package.json` (bin → dist/cli.js, dep `@synchub/shared`, scripts build/dev/start/test), `tsconfig.json` (extends base, outDir dist), and a stub `src/cli.ts` (`--version` only). Everything below is new/replaces the stub.

---

## Task 1: config.ts (atomic, guarded)

**Files:** Create `apps/agent/src/config.ts`, `apps/agent/src/paths.ts` (shared path helpers), `apps/agent/src/atomic.ts` (atomic write helper). Test: `apps/agent/src/config.test.ts`.

- [ ] **Step 1: Failing test** `config.test.ts` (Vitest; use a temp dir via `SYNCHUB_CONFIG` env pointing into `os.tmpdir()` + a fixed subdir, cleaned in afterEach). Cover: `saveConfig(cfg)` then `loadConfig()` round-trips `{hubUrl, machineToken, machineId}`; `loadConfig()` returns `null` when the file is absent; a **corrupt** file (write `"{ not json"`) → `loadConfig()` returns `null` (does NOT throw — the crash-loop fix); the written file is created with the dir made recursively; two concurrent-ish saves don't corrupt (atomic). Run → FAIL.
- [ ] **Step 2: `atomic.ts`** — `export function writeFileAtomic(path: string, data: string): void` — `mkdirSync(dirname, {recursive:true})`; write to `path + ".tmp"` via `openSync`/`writeSync`/`fsyncSync`/`closeSync`; `renameSync(tmp, path)`; best-effort dir fsync in try/catch (fails on Windows — swallow); on any write error, `rmSync(tmp, {force:true})` then rethrow. (Mirror the hub's `RelayStoreService` atomic write.)
- [ ] **Step 3: `paths.ts`** — `export function configPath()` = `process.env.SYNCHUB_CONFIG ?? join(homedir(), ".synchub", "config.json")`; `export function statePath()` = `process.env.SYNCHUB_STATE ?? join(homedir(), ".synchub", "state.json")`. (Env-overridable — needed for the OS-service user-independent config path in 4c.)
- [ ] **Step 4: `config.ts`** — `interface AgentConfig { hubUrl: string; machineToken: string; machineId: number; notifications?: boolean }`. `loadConfig(path = configPath()): AgentConfig | null` — `existsSync ? tryParse(readFileSync) : null`, where `tryParse` wraps `JSON.parse` in try/catch returning `null` on failure (guard — the fix). `saveConfig(cfg, path = configPath()): void` — `writeFileAtomic(path, JSON.stringify(cfg, null, 2))`; best-effort `chmodSync(path, 0o600)` in try/catch.
- [ ] **Step 5:** Run test → PASS. `pnpm --filter @synchub/agent build`. Commit `feat(agent): config load/save (atomic, corrupt-safe)`.

---

## Task 2: state.ts (atomic, batched, guarded)

**Files:** Create `apps/agent/src/state.ts`. Test: `apps/agent/src/state.test.ts`.

Per-file base-hash store keyed by `` `${projectId}/${filename}` ``. Fixes: guarded parse (no crash on corrupt), atomic write, and **batched/debounced** persistence (not a full sync rewrite on every `set`).

- [ ] **Step 1: Failing test** `state.test.ts` (temp `SYNCHUB_STATE`): `createState()` on a missing file → empty; `set(pid,fn,hash)` then `get(pid,fn)` returns the hash; `del(pid,fn)` removes it (`get` → null); a corrupt state file → `createState()` returns an empty store (no throw); after `set`, the persisted file (once flushed) round-trips on a fresh `createState()`; `flush()`/close persists pending writes atomically. Include a test that many `set` calls don't each cause a separate synchronous full-file write (e.g. spy on the atomic writer OR assert writes are debounced — a simple approach: `set` marks dirty + schedules a flush; expose `flush()` for tests and call it, asserting one write). Run → FAIL.
- [ ] **Step 2: `state.ts`** — `createState(path = statePath())` returns an object with `get(projectId, filename): string | null`, `set(projectId, filename, hash): void`, `del(projectId, filename): void`, `flush(): void`, `close(): void`. Internally: load via guarded parse (corrupt → `{}`); keep an in-memory `Map`/record; `set`/`del` mutate memory + mark dirty + schedule a debounced flush (e.g. a short timer, ~200ms) that calls `writeFileAtomic` once; `flush()` writes immediately if dirty; `close()` flushes + clears the timer. Use `writeFileAtomic` from `atomic.ts`. (This fixes audit #3/#16 — batched atomic writes, and makes `del` a real, used function fixing #4.)
- [ ] **Step 3:** Run test → PASS. Build. Commit `feat(agent): state store (per-file base hash, atomic, batched, del)`.

---

## Task 3: hasher.ts + api.ts (tolerant client)

**Files:** Create `apps/agent/src/hasher.ts`, `apps/agent/src/api.ts`. Test: `apps/agent/src/{hasher,api}.test.ts`.

- [ ] **Step 1: Failing tests.** `hasher.test.ts`: `hashContent("x")` equals the known sha256 hex (`2d711642...4881`) — MUST match the server's algorithm. `api.test.ts` (mock `global.fetch`): `createApi({hubUrl, machineToken})` sends `X-Machine-Token` on `getMappings`/`getManifest`/`push`; a 2xx JSON body parses to the typed shape (validate with `@synchub/shared` schemas); a **non-JSON** 2xx/5xx body does NOT throw — it surfaces a typed error/`null` (audit #8 fix); a **401** surfaces a distinct "unauthorized"/token-revoked signal (audit #10); `pull` returns raw text (not JSON) and `null` on non-OK; `pairRedeem(hubUrl, code, info)` (unauthenticated) posts to `/api/agent/pair/redeem` and returns `{machineToken, machineId}`. Run → FAIL.
- [ ] **Step 2: `hasher.ts`** — `export function hashContent(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }` (exact port).
- [ ] **Step 3: `api.ts`** — `createApi({hubUrl, machineToken})`. A private `request(method, path, body?)` that fetches with `X-Machine-Token`, then: on 401 → throw/return a typed `Unauthorized` marker (callers surface "re-pair"); on non-2xx → a typed `ApiFailure {status}` (not a throw that aborts a batch); on 2xx → `const text = await res.text(); if (!text) return null; try { return JSON.parse(text) } catch { return <parse-error marker> }` — never an unguarded throw. Methods: `getMappings()` (parse `z.array(AgentMapping)`), `getManifest(projectId)` (parse `z.array(ManifestEntry)`), `pull(projectId, filename)` (raw `res.ok ? res.text() : null`), `push(projectId, filename, content, baseHash)` (POST `{filename, content, base_hash}`, parse `PushResponse`). Plus a standalone `pairRedeem(hubUrl, code, info)` (own fetch, guarded parse). Return a small discriminated result type where useful so 4b's reconcile can branch cleanly (e.g. `{ok:true, data}` | `{ok:false, kind:"unauthorized"|"http"|"parse"|"network", status?}`). Keep it simple and testable.
- [ ] **Step 4:** Run tests → PASS. Build. Commit `feat(agent): hasher + tolerant api client (X-Machine-Token, 401/non-JSON safe)`.

---

## Task 4: notifier.ts + cli.ts (pair + stubs)

**Files:** Create `apps/agent/src/notifier.ts`; replace `apps/agent/src/cli.ts`; add `node-notifier` dep. Test: `apps/agent/src/cli.test.ts` (+ a notifier smoke).

- [ ] **Step 1:** Add `node-notifier@^10` (+ `@types/node-notifier` dev) to `apps/agent`. `pnpm --filter @synchub/agent install`.
- [ ] **Step 2: Failing test** `cli.test.ts`: `pair(code, hubUrl, deps)` (make the CLI's command handlers unit-testable by injecting an `api`/`saveConfig` or by exporting the handler fns): with a mocked `pairRedeem` returning `{machineToken, machineId}`, `pair` saves the config (spy `saveConfig`) and reports success; a failed redeem reports the error + non-zero. `--version` prints the version READ FROM `package.json` (not a hardcoded string — audit #14): import the version (e.g. a generated `version.ts`, or read `package.json` via a JSON import) and assert it matches. A `status` command prints paired/unpaired + hub URL. Run → FAIL.
- [ ] **Step 3: `notifier.ts`** — `createNotifier(enabled = true)` → `{ notify(title, message): void }` that lazily/dynamically imports `node-notifier`, fully fail-safe (missing module / unsupported platform never throws), no-op when `enabled=false`. (Port of the legacy notifier.)
- [ ] **Step 4: version** — expose the package version without a hardcoded literal: either `import pkg from "../package.json" with { type: "json" }` (Node 22 JSON import) and use `pkg.version`, OR a tiny `version.ts` the build stamps. Pick the simplest that works under `tsc` + the runtime; use it for `--version` AND the pair/redeem `agent_version`.
- [ ] **Step 5: `cli.ts`** — commands: `pair <CODE> <hubUrl>` (redeem via `api.pairRedeem`, `saveConfig`, print the config path; version from package.json in the info payload; support an optional `--label`), `run` (for now: load config or error; print "sync engine lands in 4b" — the real loop is 4b; keep it a clean stub that 4b fills), `status` (print paired hubUrl/machineId or "not paired"), `--version`/`-v`. Structure the command handlers as exported functions taking injected deps (api, config load/save, a logger) so they're unit-testable without spawning a process; `main(argv)` dispatches. Usage banner for unknown/missing.
- [ ] **Step 6:** Run tests → PASS. `pnpm --filter @synchub/agent build`, then `node apps/agent/dist/cli.js --version` prints the real version; `node apps/agent/dist/cli.js status` runs. Commit `feat(agent): cli (pair/status/version-from-pkg) + notifier`.

---

## Task 5: Verify + review

- [ ] **Step 1:** `pnpm --filter @synchub/agent test` (all pass, count), `pnpm --filter @synchub/agent build`, monorepo `pnpm lint && pnpm build && pnpm test` (all green — report per-package). `git status --porcelain hub 2>/dev/null; git status --porcelain agent/` → legacy `agent/` untouched.
- [ ] **Step 2:** Confirm the agent speaks the real contract (types imported from `@synchub/shared`; endpoints/paths/headers match the hub-api agent controllers). Summarize.
- [ ] **Step 3:** Commit any final wiring. Orchestrator runs a Phase-4a review.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §2/§3/§6-4a):** config+state atomic/guarded/batched (Tasks 1,2 — audit #1,2,3,16,4); hasher matches server (Task 3); tolerant api + 401 (Task 3 — audit #8,10); notifier + cli pair/status/version-from-pkg (Task 4 — audit #14). Live sync (queue/reconcile/watcher/ws) is 4b; distribution is 4c.
- **No placeholders:** each task cites the legacy behavior + the audit fix + the shared schema to validate against. `run` is intentionally a clean stub (4b fills it).
- **Type/naming:** `writeFileAtomic` (Task 1) reused by state (Task 2); `createApi` result type (Task 3) consumed by cli (Task 4) + reconcile (4b); `@synchub/shared` schemas validate every wire shape.
