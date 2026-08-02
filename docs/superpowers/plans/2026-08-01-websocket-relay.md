# WebSocket Relay Implementation Plan (Phase 4)

> Executed inline with TDD. Adds live fan-out, manual sync trigger, presence, and live notifications on top of the REST sync engine.

**Delivered:**

- `lib/realtime.js` — `createRealtime(db)` broker:
  - `attach(server)` handles HTTP upgrades for `/ws/agent?token=<machine_token>`
    and `/ws/user?token=<session_token>` (bad/missing token → socket destroyed).
  - Tracks `agentsByMachine` / `usersByUser` connection sets.
  - `notifyProjectChanged(projectId, {filename, hash, excludeMachineId})` — sends
    `{type:"changed"}` to other online agents mapped to an **auto**-mode project.
  - `triggerSync(projectId)` — `{type:"sync"}` to all mapped agents (manual mode).
  - `pushNotification(userId, note)` — `{type:"notification"}` to the user's UIs.
  - Presence: agent connect → `machines.status='online'`; last socket close → `'offline'`.
  - `close()` terminates clients + closes the WSS (clean teardown).
- `app.js` creates the broker, passes it to agent + project routes; `server.js`
  and the test harness call `realtime.attach(server)` after `listen`.
- `routes/agent.js` — push fans out `changed` to peers on forward/merged/first-sync;
  pushes live notifications on auto-merge and true conflict.
- `routes/projects.js` — `POST /:id/sync-now` triggers a manual reconcile; conflict
  resolution fans out the new canonical + pushes the resolution notification.

**Tests (`test/realtime.test.js`, 4):** push→peer `changed`; conflict→user
`notification`; online-on-connect/offline-on-close; bad-token rejection.
Full suite: 31 green (~1.5s).

**Teardown note:** `startTestServer().close()` calls `realtime.close()` +
`server.closeAllConnections()` so live WS sockets don't stall `server.close()`.

**Deferred:** dashboard metrics endpoints + notification-center UI/read-state (Phase 5); the Agent that consumes these WS messages (Phase 6).
