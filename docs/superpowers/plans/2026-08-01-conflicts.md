# Conflicts Implementation Plan (Phase 3)

> Executed inline with TDD. Turns Phase-2's "409 on stale base" into real conflict handling: auto-merge first, manual candidate resolution otherwise.

**Delivered:**

- `lib/merge.js` — `autoMerge(canonical, incoming)` for append-only JSONL:
  - `behind` (incoming ⊆ canonical) → keep canonical;
  - `forward` (canonical ⊆ incoming) → take incoming;
  - `merged` → shared prefix + union of both tails, ordered by each line's
    `timestamp` field (dedups exact-duplicate lines);
  - `conflict` → a tail line isn't valid JSON (edit/rewind, not an append) → manual.
- `models/conflicts.js` — `open`, `get`, `listOpenForProject`, `listOpenForUser`
  (with project alias), `resolve`, `candidateFilename` (candidate parked in relay store).
- `models/notifications.js` — `record`, `listForUser`, `unreadCount`, `markRead`, `markAllRead`.
- `routes/agent.js` push handler rewritten: on stale base, run `autoMerge`;
  write result as canonical for forward/merged (merged also records a resolved
  `auto_merged` conflict + a `sync` notification); for a true conflict, park the
  candidate, `open` a conflict, emit a `conflict` notification, return 409 `{conflictId}`.
- `routes/projects.js` — `GET /:id/conflicts`; `POST /:id/conflicts/:conflictId/resolve`
  with `{choice: "candidate"|"canonical"}` (candidate promotes the parked content to
  canonical), removes the candidate, marks resolved, notifies.
- `routes/conflicts.js` — `GET /api/conflicts` (all open across the user's projects; drives the Conflicts page + sidebar count).

**Tests:** `merge.test.js` (4 unit cases: forward/behind/merged/conflict) +
`conflicts.test.js` (true-conflict → list → resolve-to-candidate round-trip;
auto-merge leaves no open conflict). Full suite: 27 green.

**Deferred:** live fan-out of resolved/merged content to other machines (Phase 4);
notification-center UI + read state endpoints (Phase 5).
