# Phase 4 — Agent (TypeScript port + single-binary) Design

**Date:** 2026-08-02
**Status:** Design — awaiting approval before planning
**Parent:** `2026-08-01-synchub-proper-app-design.md` (Phase 4)
**Legacy source:** the root-level `agent/` (vanilla JS, ~350 LOC), mapped in full.

## 1. Goal

Port the legacy per-machine **agent** to TypeScript in `apps/agent`, fix the audit
bugs, and make it **trivially installable** — a single self-contained binary per OS
+ a one-line install script + OS-service registration. After this, the legacy
`agent/` is deleted and SyncHub is entirely the new stack. This directly serves the
owner's stated priority: *the agent must be easy to install on each machine.*

The agent-facing server contract is **unchanged** (X-Machine-Token; the same
`mappings`/`manifest`/`pull`/`push`/`pair-redeem` shapes; `/ws/agent?token=`) except
the manual-sync WS message renamed `"sync"` → `"sync-trigger"`. So the core is a
faithful behavior port + the fixes + distribution.

## 2. Architecture

`apps/agent` becomes a lightweight TypeScript CLI (NOT NestJS — too heavy for a
watcher). It consumes the `@synchub/shared` contract for all wire types.

```
apps/agent/src/
├── cli.ts              # commands: pair, run, status, --version (version from package.json)
├── config.ts          # ~/.synchub/config.json — atomic write, guarded parse
├── state.ts           # ~/.synchub/state.json — per-file base hash; atomic + debounced write, guarded parse
├── hasher.ts          # sha256 (must match server)
├── api.ts             # REST client (X-Machine-Token) — tolerant parsing, 401 surfaced
├── ws.ts              # /ws/agent client — backoff reconnect + reconnect→reconcile hook
├── notifier.ts        # OS notifications (node-notifier), fail-safe
├── watcher.ts         # chokidar (auto-mode), incremental push, unlink handling
├── sync-queue.ts      # a single serialized work queue (the core fix — no overlapping reconciles)
├── reconcile.ts       # manifest/pull/push/merge per project (respects sync_mode)
└── agent.ts           # orchestration: boot reconcile → watcher → ws → timer, all through the queue
```

**The central design change: a single serialized `SyncQueue`.** Every unit of work
— boot reconcile, a 30s tick, a WS `changed` pull, a WS `sync-trigger`, a watcher
push, a reconnect catch-up — is enqueued and runs **one at a time** (per-project or
globally serialized). This eliminates the overlapping-reconcile races (audit #6),
makes state writes safe, and gives a single place to handle errors/retries.

## 3. Audit fixes (must-clear list, from the agent audit §9)

| # | Fix |
|---|-----|
| 1,2,16 | **Crash-safe config/state:** guarded `JSON.parse` (corrupt → fall back / re-pair prompt, never crash-loop); **atomic writes** (temp file + `fsync` + `rename`); state writes debounced/batched, not per-`set`. |
| 3 | State no longer full-rewritten synchronously on every hash update — batched + atomic. |
| 4,5,12 | **Delete + rename propagation** (see §4): watcher `unlink` handler; agent tells the server a file was deleted; server removes it + emits a `deleted` WS message; other agents delete locally. Kills resurrection + rename-duplication. Local tombstones prevent re-pull. |
| 6,17 | **Single serialized SyncQueue** — no concurrent reconciles; `stop()` drains/cancels in-flight work. |
| 7,15 | **Live-session sync:** replace the 500ms `awaitWriteFinish` stall with append-aware incremental push (short stability window or size/mtime poll) so an actively-appending transcript syncs promptly; async file I/O (no sync readdir/readFile blocking the loop). |
| 8 | **Tolerant API client:** guard all response parsing (non-JSON/HTML/502 → typed error, not a throw); per-file try/catch so one bad response doesn't abort the batch; boot reconcile wrapped so a bad response never crashes startup. |
| 9 | **WS heartbeat + reconnect→reconcile:** on (re)connect, enqueue a full `reconcileAll` catch-up; app-level liveness so a half-open socket reconnects. |
| 10 | **Token refresh / re-pair:** a 401 surfaces a clear "machine token revoked — re-pair" state (and a `status` command), not a silent log-drop. |
| 11 | **Manual mode respected:** `reconcileProject` checks `sync_mode` — `manual` only pulls/pushes on an explicit `sync-trigger`, never on the periodic timer or boot; `stopped` does nothing; `auto` is live. |
| 13 | **Bounded debounce timers** — delete the map entry when a timer fires. |
| 14 | **Version from `package.json`** (not a hardcoded string) on pair/redeem. |

## 4. Delete / rename propagation (needs a small server addition)

Resurrection (audit #5) is a real data-integrity bug and can't be fixed agent-only.
Minimal, safe cross-cutting addition:

- **Shared contract:** add a `WsDeleted { type:"deleted", projectId, filename }` message
  (browser + agent directed) to `@synchub/shared/ws.ts`, and a `DeleteRequest`/response.
- **hub-api (small, additive):** `POST /api/agent/delete/:projectId` `{filename}`
  (MachineAuthGuard, requireMapping) → in a transaction: remove the `file_state` row
  (and GC the blob via the existing orphan sweep), record a `delete` event, and
  `realtime.notifyProjectChanged`-style fan-out a `deleted` message to other mapped
  agents (auto mode) + the user's browsers. No conflict semantics — last delete wins;
  a subsequent push of the same filename simply re-creates it (first-sync path).
- **agent:** the watcher's `unlink` handler enqueues a delete → calls the endpoint →
  writes a **local tombstone** (so reconcile won't re-pull it before the manifest
  catches up). On a `deleted` WS message (or a manifest that dropped a file the agent
  has), the agent removes the local file + its state entry. Rename = unlink(old) +
  add(new) handled by these two paths (old propagates as delete, new as a push) —
  no duplication.

This is the only Phase-4 work that touches hub-api + shared; everything else is the
agent. (Frontend already invalidates on `changed`; a `deleted` is treated the same
way — the file list refetches.)

## 5. Distribution — the "easy install" goal

- **Single self-contained binary per OS** via **Node 22 SEA** (Single Executable
  Applications) — bundle the agent (esbuild → one JS file) into the node binary, no
  Node/npm required on the target. (Alternatives considered: `pkg` is unmaintained;
  Bun `--compile` is clean but adds a second toolchain — SEA keeps us on Node.) Build
  `synchub-agent-{linux,macos,win}` in CI, publish to GitHub Releases.
  - The optional Electron tray is dropped from the core install (kept as a separate,
    heavier download later if wanted) — it was the main npm-install-friction source.
  - `node-notifier` spawns platform binaries; verify it works inside a SEA bundle, or
    swap for a lighter OS-toast approach / make notifications optional.
- **One-line install script:** `curl -fsSL <url>/install.sh | sh` (mac/linux) and
  `irm <url>/install.ps1 | iex` (windows) — download the right binary, place it on
  PATH, prompt for a pairing code, and register the OS service.
- **OS service templates, fixed:** a **user-independent config path** (`--config` /
  `SYNCHUB_CONFIG` baked into the unit, not the running user's `~`), correct per-OS
  units — systemd (no hardcoded node path; `After=network-online.target`), launchd
  (Apple-Silicon path-agnostic), Windows a real **Session-0 service** (via a service
  wrapper) not a logon task. An `install`/`uninstall`/`status` CLI subcommand set.
- **Auto-update** channel: a `synchub-agent update` that checks GitHub Releases
  (best-effort, optional) — nice-to-have, may defer.

## 6. Delivery — sub-phases

- **Phase 4a — Core plumbing:** `config`, `state` (atomic+guarded+batched), `hasher`,
  `api` (tolerant), `notifier`, and the `cli` (`pair` with version-from-package.json,
  a stub `run`/`status`). TS + Vitest unit tests. No live sync yet.
- **Phase 4b — Sync engine + fixes:** `sync-queue`, `reconcile` (sync_mode-aware),
  `watcher` (incremental, unlink), `ws` (backoff + reconnect→reconcile), `agent`
  orchestration — all serialized through the queue, all audit fixes. Plus the
  **delete-propagation** server addition (shared + hub-api endpoint + WS `deleted`)
  and the agent side. Tested against a real hub-api (an e2e like the legacy
  `e2e-docker.mjs`, or an in-process hub-api).
- **Phase 4c — Distribution + cutover:** SEA single-binary build (+ esbuild bundle),
  install scripts, OS service templates, `install/uninstall/status` subcommands; CI
  release job; then **delete legacy `agent/`** + final README/docs. Optional
  auto-update.

Each sub-phase: its own bite-sized plan → subagent-driven execution with spec + code
review per task.

## 7. Testing

- Unit (Vitest): config/state atomicity + corrupt-file recovery; hasher matches
  server sha256; api tolerant parsing + 401; sync-queue serialization; reconcile
  decision table incl. manual-mode gating and delete/rename; watcher debounce +
  unlink.
- Integration: agent ↔ a real (in-process or dockerized) hub-api — pair, push/pull,
  auto-merge, conflict, live `changed` pull, `sync-trigger`, reconnect→reconcile,
  delete propagation. (Port the intent of the legacy `e2e-docker.mjs`.)
- The single-binary + install scripts get a smoke test in CI (build the binary, run
  `--version`, dry-run the install script) where feasible.

## 8. Non-goals / deferred
- No re-introduction of the Electron tray in the core install (separate optional
  download if ever wanted).
- Auto-update may ship after the core (best-effort).
- No delta/chunked transfer (still full-file, per the master non-goals).
