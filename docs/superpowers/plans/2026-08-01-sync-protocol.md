# Sync Protocol Implementation Plan (Phase 2)

> Executed inline with TDD (node:test). Builds the agent-facing relay engine on top of the Phase-1 Hub core.

**Goal:** Let agents discover their work, and push/pull transcript content through the Hub with canonical `file_state` tracking and forward-update semantics.

**Delivered:**

- `lib/relayStore.js` — flat-file store at `<relayDir>/<userId>/<projectId>/<filename>`; `isSafeFilename` rejects path traversal (only `[A-Za-z0-9._-]`).
- `lib/crypto.js` += `hashContent()` (sha256) — canonical hash for sync/conflict.
- `models/fileState.js` — `get`, `listForProject`, `upsert` (one row per project+filename).
- `models/events.js` — `record`, `recent` (feeds Phase-5 metrics/timeline).
- `models/mappings.js` += `listForMachine`, `get`.
- `routes/agent.js` (auth via `X-Machine-Token`):
  - `GET /api/agent/mappings` — projects this machine watches + mode + local path.
  - `GET /api/agent/manifest/:projectId` — canonical `{filename,hash,size,updated_at}[]`.
  - `GET /api/agent/pull/:projectId/:filename` — canonical content.
  - `POST /api/agent/push/:projectId` — `{filename, content, base_hash}`:
    - identical content → `unchanged`;
    - `base_hash` matches canonical (or first sync) → `accepted` (forward update, writes relay + `file_state` + `event`);
    - `base_hash` stale → **409 conflict** (canonical untouched; candidate storage + auto-merge come in Phase 3).
  - Every agent request touches `machines.last_seen_at` + `status='online'`.
- `app.js` — creates the relay store (env `RELAY_STORE_DIR`, default `hub/relay-store/`), mounts agent routes; test harness gives each test an isolated temp relay dir.

**Tests (`test/agent.test.js`, 4 cases):** mappings listing; push→manifest→pull round-trip; forward-update then stale-base conflict; no-op unchanged; auth/unmapped/unsafe-filename rejection. Full suite: 21 green.

**Deferred to later phases:** conflict candidate storage + auto-merge (Phase 3); live fan-out to other machines (Phase 4); metrics endpoints reading `events` (Phase 5).
