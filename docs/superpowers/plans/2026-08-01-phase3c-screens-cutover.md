# Phase 3c: Remaining Screens + Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. UI tasks MUST also load the **frontend-design** skill. Steps use checkbox (`- [ ]`).

**Goal:** Finish the SPA — **Conflicts** (list + resolve), **Notifications** (list + read + live bell badge), **Settings/profile** — then **cut over**: hub-api serves the built SPA (single origin), delete the legacy `hub/`, add `docker-compose.yml` + a hub-api `Dockerfile` + `.env.example`, and self-host the fonts (3a carry-forward). After this, SyncHub's Hub is entirely the new stack.

**Architecture:** Screens follow the established 3a/3b pattern (useQuery + `qk` keys, isPending skeletons, `ErrorPanel`, empty states, shadcn primitives, `sonner` toast, realtime invalidation). The bell badge reads `NotificationsSummary.unread` from `qk.notifications` (invalidated live on WS `notification`). Cutover: NestJS `ServeStaticModule` serves `apps/hub-web/dist` with an SPA fallback (non-`/api`, non-`/ws`, non-`/health` routes → `index.html`); a multi-stage Dockerfile builds hub-web + hub-api into one image; `docker-compose.yml` runs it with a SQLite volume + relay-store volume.

**Tech Stack:** React 18 + TanStack Router/Query + Tailwind/shadcn (frontend); NestJS `@nestjs/serve-static` (backend static serve); Docker.

**Available:** all endpoints (`getConflicts/resolveConflict`, `getNotifications/markNotificationRead/markAllNotificationsRead`, `getMe/updateMe/updateNotifyWebhook`), `qk.conflicts/notifications/me`, `ConflictWithProjectAlias`/`NotificationsSummary`/`MeResponse` types, `ResolveConflictRequest`, shadcn primitives, `ErrorPanel`/patterns, `timeAgo`. RealtimeProvider already invalidates `qk.conflicts`/`qk.notifications` on the relevant WS messages + toasts.

**Conventions:** Windows PowerShell; only `apps/hub-web/`, `apps/hub-api/`, and root deploy files (`docker-compose.yml`, `.env.example`) — plus DELETING `hub/` in Task 6; don't touch legacy `agent/` (Phase 4); commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer; keep tests + lint + build green. UI tasks: frontend-design. jsdom Radix note: stub `scrollIntoView`/`hasPointerCapture`/`releasePointerCapture`; `fireEvent.click` opens triggers.

---

## Task 1: Conflicts screen (list + resolve)

**Files:** `src/routes/Conflicts.tsx` (replace placeholder); `src/components/ResolveConflictDialog.tsx`; test; `router.tsx`.

- [ ] **Step 1 (frontend-design).** Failing test (mock `getConflicts`/`resolveConflict`): loading → skeletons; loaded → a row per open conflict (project_alias, filename, created via timeAgo, an `auto_merged` badge if true); a "Resolve" action opens a dialog offering **Keep candidate** (the incoming machine's version) vs **Keep canonical** (existing); confirming calls `resolveConflict(project_id, conflict_id, {choice})` and invalidates `qk.conflicts` (+ `qk.projectConflicts(project_id)` + `qk.dashboardMetrics`); empty state ("No conflicts — everything's in sync"); error state. Run → FAIL.
- [ ] **Step 2:** `ResolveConflictDialog.tsx` — a shadcn Dialog explaining the conflict (filename + project + "diverged and needs manual resolution"), two clearly-labeled choices (candidate = "the version from `<machine>`", canonical = "the current synced version") via radio/segmented buttons or two action buttons; a short note that this can't be undone. `useMutation(({projectId,conflictId,choice}) => resolveConflict(projectId, conflictId, {choice}))` → onSuccess invalidate `qk.conflicts` + `qk.projectConflicts(projectId)` + `qk.dashboardMetrics` + toast "Conflict resolved (kept <choice>)" + close; ApiError inline (e.g. 404 already-resolved, 410 candidate-missing).
- [ ] **Step 3:** `Conflicts.tsx` — `useQuery(qk.conflicts, getConflicts)`; header ("Conflicts" + subtitle); `Table` of `ConflictWithProjectAlias` rows (project_alias → link to `/projects/$id`, filename mono, created timeAgo, auto_merged Badge, a "Resolve" button opening the dialog with that conflict); skeleton/empty/error. Polished per frontend-design. Live-updates via `qk.conflicts` (realtime already invalidates on WS `conflict`).
- [ ] **Step 4:** `router.tsx` — `/conflicts` → real `Conflicts`. Run test → PASS. Build. Commit `feat(hub-web): conflicts screen (list + resolve)`.

---

## Task 2: Notifications screen + live bell badge

**Files:** `src/routes/Notifications.tsx` (replace placeholder); modify `src/shell/Topbar.tsx` (bell badge); test; `router.tsx`.

- [ ] **Step 1 (frontend-design).** Failing test: (Notifications) loading → skeletons; loaded → a list of notification items (title, body, type badge, created timeAgo, an unread indicator); a "Mark all read" button calls `markAllNotificationsRead` + invalidates `qk.notifications`; clicking an unread item (or its "mark read") calls `markNotificationRead(id)` + invalidates; empty state; error. (Topbar) the bell shows an unread-count badge from `qk.notifications` `unread` (a `useQuery(qk.notifications)` in the topbar), and it's hidden when 0. Run → FAIL.
- [ ] **Step 2:** `Notifications.tsx` — `useQuery(qk.notifications, getNotifications)` → `{ unread, items }`. Header with a "Mark all read" button (`useMutation(markAllNotificationsRead)` → invalidate `qk.notifications`). List of items: type icon/badge (conflict/sync/other), title, body, timeAgo, unread dot; clicking an unread item → `useMutation(markNotificationRead(id))` → invalidate. Skeleton/empty ("You're all caught up")/error. Polished.
- [ ] **Step 3:** `Topbar.tsx` — add `const { data } = useQuery({ queryKey: qk.notifications, queryFn: getNotifications, staleTime: ... })`; the bell shows a small count badge when `data?.unread > 0` (replace the hardcoded placeholder dot from 3a). Clicking the bell navigates to `/notifications`. The badge updates live because RealtimeProvider invalidates `qk.notifications` on WS `notification` (and toasts).
- [ ] **Step 4:** `router.tsx` — `/notifications` → real `Notifications`. Run test → PASS. Build. Commit `feat(hub-web): notifications screen + live bell badge`.

---

## Task 3: Settings / profile screen

**Files:** `src/routes/Settings.tsx` (replace placeholder); test; `router.tsx`.

- [ ] **Step 1 (frontend-design).** Failing test (mock `getMe`/`updateMe`/`updateNotifyWebhook`): loading → skeleton; loaded → a form with name, notify_conflicts + notify_sync toggles (switches), and a webhook URL field; saving the profile calls `updateMe` (name + notify flags) and invalidates `qk.me`; saving the webhook calls `updateNotifyWebhook` (or fold into updateMe — the backend PUT /me accepts notify_webhook_url too; prefer a single `updateMe` for name+flags+webhook, and keep the dedicated webhook endpoint available); a theme preference control (light/dark/system via `useTheme`); an account section (email read-only + a Log out button). Success toast; ApiError inline. Run → FAIL.
- [ ] **Step 2:** add a shadcn `switch.tsx` (`@radix-ui/react-switch` — add the dep) for the toggles. `Settings.tsx` — `useQuery(qk.me, getMe)`; a Profile card (name Input; notify_conflicts + notify_sync `Switch`es; a webhook URL Input with a hint "we POST notifications here; must be a public https/http URL"); a Save button → `useMutation((body) => updateMe(body))` (send name, notify_conflicts, notify_sync, notify_webhook_url) → invalidate `qk.me` + toast; inline ApiError (e.g. an SSRF-blocked webhook returns... actually the webhook SSRF check is at send-time, not save-time, so saving a private URL succeeds but never fires — add a small note). An Appearance card (theme toggle: light/dark/system). An Account card (email read-only, Log out via `useAuth().logout()` → navigate `/login`). Skeleton/error. Also update `AuthProvider`/`me` consumers: after `updateMe`, the topbar user chip should reflect the new name (invalidate `qk.me` AND, if the auth-context holds a separate `user`, refresh it — simplest: have the auth-context `user` be backed by the `qk.me` query, OR expose a `refreshUser()`; if that's too invasive, at least invalidate `qk.me` and note the auth-context user may lag until reload). Keep it clean — prefer invalidating `qk.me` and having the topbar read from `useAuth()` which you refresh.
- [ ] **Step 3:** `router.tsx` — `/settings` → real `Settings`. Remove any now-unused placeholders (`Placeholders.tsx` may become empty — delete it if so + clean imports). Run test → PASS. Build. Commit `feat(hub-web): settings/profile screen`.

---

## Task 4: hub-api serves the SPA (static + fallback) + fonts self-host

**Files:** `apps/hub-api/package.json` (+`@nestjs/serve-static`); `apps/hub-api/src/app.module.ts`; `apps/hub-web` font self-host; maybe a build script.

- [ ] **Step 1:** Self-host fonts (3a carry-forward): remove the Google Fonts `@import` from `apps/hub-web/src/styles/index.css`; add the needed woff2 files under `apps/hub-web/src/assets/fonts/` (or use `@fontsource/manrope`, `@fontsource/plus-jakarta-sans`, `@fontsource/jetbrains-mono` — add these deps and import them in `main.tsx`; simplest + reliable). Verify the fonts still apply (build + a visual note). This removes the external-network dependency for a self-hosted OSS app.
- [ ] **Step 2:** Add `@nestjs/serve-static@^4` to hub-api. In `app.module.ts`, add `ServeStaticModule.forRoot({ rootPath: <path to apps/hub-web/dist>, exclude: ["/api/{*path}", "/health", "/ws/{*path}"], serveStaticOptions: { fallthrough: true } })` — serve the built SPA and fall back to `index.html` for client routes. Resolve the dist path relative to the hub-api dist at runtime (e.g. `join(__dirname, "..", "..", "hub-web", "dist")` for a Docker layout, configurable via an env var `WEB_DIST_DIR` with a sensible default). Ensure `/api/*`, `/ws/*`, `/health` are NOT shadowed by the static handler (exclude them). Add a smoke test if feasible (booting the app + GET `/` returns the index html OR 200 when dist exists; skip gracefully if dist not built in the test env).
- [ ] **Step 3:** Build order: document that `apps/hub-web` must be built before hub-api serves it. `pnpm build` (topological) builds shared → hub-web + hub-api; ensure hub-api's serve path points at hub-web/dist. Verify `pnpm --filter @synchub/hub-api build` still compiles.
- [ ] **Step 4:** Run `pnpm --filter @synchub/hub-web build` (fonts self-hosted, no external @import) + `pnpm --filter @synchub/hub-api build` + tests. Commit `feat(hub-api,hub-web): serve SPA via ServeStaticModule + self-host fonts`.

---

## Task 5: Deployment — Dockerfile + docker-compose + .env.example

**Files:** `apps/hub-api/Dockerfile`; root `docker-compose.yml` (replace the legacy one that builds `./hub`); `.env.example`.

- [ ] **Step 1:** `apps/hub-api/Dockerfile` — a multi-stage build: (a) a builder stage on `node:22`, `corepack enable pnpm`, copy the monorepo, `pnpm install --frozen-lockfile`, `pnpm --filter @synchub/shared build`, `pnpm --filter @synchub/hub-web build`, `pnpm --filter @synchub/hub-api build` (+ `prisma generate`); (b) a runtime stage on `node:22-slim`, copy the hub-api dist + node_modules (prod) + prisma + the built `hub-web/dist`, set `WEB_DIST_DIR`, expose 8080, run `prisma migrate deploy && node dist/main.js` (an entrypoint script that runs migrations then starts). Handle the monorepo/pnpm workspace layout so `@synchub/shared` resolves at runtime (either bundle or copy the shared dist + keep the workspace symlink structure). Keep it correct over clever.
- [ ] **Step 2:** root `docker-compose.yml` — replace the legacy `build: ./hub` service with one building `apps/hub-api` (the Dockerfile), port `8080:8080`, env `DATABASE_URL=file:/data/synchub.db`, `RELAY_STORE_DIR=/data/relay-store`, `WEB_DIST_DIR=...`, a named volume mounted at `/data` (SQLite + relay-store persist), `restart: unless-stopped`. (The legacy compose referenced `./hub`; the new one builds the new stack.)
- [ ] **Step 3:** `.env.example` at repo root (or `apps/hub-api/.env.example`) documenting `DATABASE_URL`, `RELAY_STORE_DIR`, `PORT`, `WEB_DIST_DIR` with defaults + comments.
- [ ] **Step 4:** Verify the Dockerfile builds IF docker is available (`docker build`); if docker isn't available in this environment, do a careful dry-review of the Dockerfile steps for correctness (paths, build order, prisma, workspace resolution) and note that a real `docker build` should be run before deploy. Do NOT block on docker. Commit `feat(deploy): hub-api Dockerfile + docker-compose + .env.example`.

---

## Task 6: Cutover — delete legacy hub/ + verification + final Phase 3 review

- [ ] **Step 1:** Confirm the new stack fully replaces legacy `hub/`: every legacy endpoint is ported (Phase 2 review confirmed), every UI screen exists (3a/3b/3c), the SPA is served by hub-api (Task 4), deploy config points at the new stack (Task 5). With that confirmed, **delete the legacy `hub/` directory** (`git rm -r hub`). NOTE: legacy `agent/` STAYS (Phase 4 ports it — it's the current agent clients use). Update the root `README.md` layout section to reflect the monorepo (hub/ gone; apps/hub-api + apps/hub-web + packages/shared).
- [ ] **Step 2: Full verification** (report actual): `pnpm install` (clean), `pnpm lint` (0 errors), `pnpm build` (all packages incl. hub-web + hub-api), `pnpm test` (all packages green — shared/hub-api/hub-web; agent still passWithNoTests). Confirm nothing referenced the deleted `hub/` (grep the monorepo for `../hub`, `hub/src`, etc. — the docs/specs reference it as the historical source, which is fine; CODE must not import it).
- [ ] **Step 3:** Confirm `git status` clean; legacy `agent/` untouched. Commit `chore: retire legacy hub/ (replaced by apps/hub-api + apps/hub-web)`. Then the orchestrator runs a final Phase-3 (whole frontend) review.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §4/§6-3c):** Conflicts list+resolve (Task 1); Notifications + live bell (Task 2); Settings/profile (Task 3); SPA served by hub-api + fonts self-hosted (Task 4); Dockerfile + compose + .env.example (Task 5); legacy hub/ deleted + verification (Task 6).
- **Realtime:** conflicts/notifications live via `qk.conflicts`/`qk.notifications` (already invalidated by RealtimeProvider); bell badge live.
- **Cutover safety:** delete `hub/` only after the new stack fully replaces it (endpoints ported, screens built, SPA served, deploy config updated); `agent/` stays for Phase 4.
- **frontend-design** on Tasks 1-3.
- **Deferred to Phase 4:** the agent (TS port + single-binary + install script + OS service).
