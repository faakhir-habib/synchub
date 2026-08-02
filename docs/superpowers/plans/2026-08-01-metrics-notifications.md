# Metrics & Notifications Implementation Plan (Phase 5)

> Executed inline with TDD. Makes the dashboard tiles real and adds the notification center + personal webhook relay.

**Delivered:**

- `models/stats.js` — `dashboardMetrics(db, userId)`: projects (total/syncing),
  machines (total/online), openConflicts, eventsToday, dataTransferredBytes,
  sessionsSyncedToday, syncSuccessRate (7-day ok/(ok+conflict)), avgLatencyMs,
  unreadNotifications — all from the `events` table + current state.
- `lib/notify.js` — `notifyUser(db, realtime, {...})`: records the notification,
  pushes it live over WS, and best-effort POSTs it to the user's
  `notify_webhook_url` (fire-and-forget; failures never surface).
- Push handler now records real `latency_ms` per accepted/merged push.
- `routes/dashboard.js` — `GET /api/dashboard/metrics`, `GET /api/dashboard/activity`.
- `routes/notifications.js` — `GET /` (items + unread), `POST /:id/read`, `POST /read-all`.
- `agent.js` + `projects.js` route notifications through `notifyUser` so conflict,
  auto-merge, and resolution events all fan out live **and** hit the webhook.

**Tests:** `dashboard.test.js` (metrics reflect pushes/sessions/conflicts +
success-rate drop; activity feed) and `notifications.test.js` (list/read/read-all;
**live webhook capture** via a local HTTP server). Full suite: 34 green.

**Deferred:** wiring the dashboard/notification UI to these endpoints (Phase 5 UI,
next) and the Agent (Phase 6).
