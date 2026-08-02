# Phase 3 — Frontend (React SPA) Design

**Date:** 2026-08-01
**Status:** Design — awaiting approval before planning
**Parent:** `2026-08-01-synchub-proper-app-design.md` (Phase 3)
**Backend contract:** hub-api (Phase 2 complete) — REST under `/api/*` + WS `/ws/user`.

## 1. Goal

Build the full **React + Vite + TypeScript SPA** (`apps/hub-web`) that replaces the
legacy vanilla multi-page UI. It must:
- **Eliminate the full-page-refresh** (the original complaint): one persistent
  app-shell + WebSocket, client-side routing, only route content swaps.
- Be **fully realtime** (spec §2.1): live presence, sync progress, notifications,
  and data invalidation over the persistent `/ws/user` socket with reconnect — no
  manual refresh anywhere.
- Reproduce **every legacy screen** with a modern, polished look.
- Consume the typed `@synchub/shared` contract end-to-end.

When feature-complete, the legacy `hub/` is deleted and a `docker-compose.yml`
serves hub-api (which statically serves the built hub-web).

## 2. Stack (decided)

- **React 18 + Vite + TypeScript** (skeleton exists).
- **TanStack Router** (type-safe, file-less route tree) + **TanStack Query** (server
  state, caching, invalidation — the backbone of the realtime story).
- **Tailwind CSS + shadcn/ui** (owner decision): utility CSS + copy-in accessible
  components (Button, Dialog, Table, Toast, Card, Input, DropdownMenu, Badge, etc.),
  **dark + light** theme via CSS variables. Lucide icons.
- **zod** (via `@synchub/shared`) validates every API response at the client boundary.
- Design quality: implementers follow the **frontend-design** skill for the visual
  layer (distinctive, production-grade, not generic-AI-looking).

## 3. Architecture

```
apps/hub-web/src/
├── main.tsx                     # providers: QueryClient, RouterProvider, Theme, Auth, Realtime
├── router.tsx                   # route tree (auth routes + protected app routes)
├── lib/
│   ├── api.ts                   # typed fetch client (base, auth header, zod-parse, {error,code})
│   ├── endpoints.ts             # per-resource typed calls (auth/projects/machines/...) using @synchub/shared
│   ├── query-keys.ts            # centralized query keys
│   └── ws.ts                    # WebSocket client: connect, backoff-reconnect, typed message dispatch
├── auth/
│   ├── auth-context.tsx         # token storage + current user; requireAuth route guard
│   └── {Login,Signup}.tsx
├── realtime/
│   └── realtime-provider.tsx    # opens /ws/user once; routes WsMessage → query invalidation + toasts + presence store
├── components/ui/*              # shadcn components
├── components/*                 # app components (StatCard, DataTable, EmptyState, PresenceDot, ...)
├── shell/
│   ├── AppShell.tsx             # persistent sidebar + topbar + <Outlet/> (mounts ONCE)
│   └── {Sidebar,Topbar}.tsx
├── routes/                      # one file per screen (see §4)
└── styles/index.css             # Tailwind + theme tokens
```

**Realtime is the spine.** `RealtimeProvider` opens the `/ws/user?token=` socket
once (inside the authed shell), reconnects with exponential backoff, and on each
typed `WsMessage`:
- `presence` → update a presence store; machine rows re-render live.
- `changed` → `queryClient.invalidateQueries` for the affected project/dashboard.
- `sync-progress` / `sync-complete` → drive a live progress indicator + invalidate.
- `notification` → toast + invalidate the notifications query (bell badge updates).
- On (re)connect → invalidate everything (catch up on missed events, §7.1 fix).

This is what makes the UI feel live without polling or refresh.

## 4. Screens (each maps to Phase-2 endpoints)

| Route | Screen | Backend |
|-------|--------|---------|
| `/login`, `/signup` | Auth | `POST /api/auth/{login,signup}` |
| `/` | Dashboard: metric tiles, recent projects, activity feed | `GET /api/dashboard/{metrics,activity}` |
| `/projects` | Projects list + create | `GET/POST /api/projects` |
| `/projects/$id` | Project detail: mappings (add/edit/remove), tracked files, activity, **Sync now**, per-project conflicts | `GET/PUT/DELETE /api/projects/:id`, mappings, `/sync-now`, `/:id/conflicts` |
| `/machines` | Machines: list w/ **live presence**, create, **pair modal** (code + expiry), delete | `GET/POST/DELETE /api/machines`, `POST /pair` |
| `/conflicts` | Conflicts list + **resolve** (candidate/canonical) | `GET /api/conflicts`, `POST /api/projects/:id/conflicts/:cid/resolve` |
| `/notifications` | Notifications list + mark read/all | `GET /api/notifications`, read/read-all |
| `/settings` | Profile: name, webhook URL, notify prefs | `GET/PUT /api/auth/me`, `/me/notify-webhook` |

Cross-cutting UI: loading **skeletons** (not the legacy "—" flash), typed **error
states**, empty states, optimistic updates where safe, a **command-less** but
keyboard-accessible shell, dark/light toggle.

## 5. Auth & API client

- **API client** (`lib/api.ts`): base URL same-origin (`/api`), attaches
  `Authorization: Bearer <token>`, parses responses through the `@synchub/shared`
  zod schemas, maps non-2xx `{error,code}` into a typed `ApiError` thrown for
  TanStack Query to surface. (The one exception — sync-push 409 — is agent-only, not
  used by the browser.)
- **Auth** (`auth-context.tsx`): token in memory + `localStorage` (matches legacy;
  httpOnly-cookie upgrade is a tracked non-goal). On boot, `GET /api/auth/me`
  validates the token; 401 → redirect to `/login`. Signup/login store the token and
  hydrate the user. `requireAuth` guards the app route subtree in TanStack Router.

## 6. Delivery — three sub-phases

- **Phase 3a — Foundation:** Tailwind + shadcn setup + theme; `lib/api` + `endpoints`
  + `query-keys`; auth (login/signup, auth-context, protected routing); persistent
  `AppShell` (sidebar/topbar); `RealtimeProvider` (WS connect + backoff-reconnect +
  message dispatch scaffold); a real **Dashboard** wired to `/api/dashboard/*` +
  presence, proving the pipeline (typed API → SPA → live). Delete the Phase-1
  placeholder Dashboard/Projects stubs.
- **Phase 3b — Core screens:** Projects list + create, Project detail (mappings,
  sync-now, activity), Machines (live presence, create, pair modal, delete). Wire the
  relevant realtime invalidations.
- **Phase 3c — Remaining + cutover:** Conflicts (list + resolve), Notifications
  (toasts + bell), Settings/profile; finish all realtime wiring (progress, reconnect
  catch-up); accessibility + polish pass; then **delete legacy `hub/`**, add
  `apps/hub-api` static-serve of the hub-web build + a root `docker-compose.yml`
  (hub-api serving the SPA), and a `.env.example` + hub-api `Dockerfile`
  (carry-forward from Phase 2).

Each sub-phase: its own bite-sized plan → subagent-driven execution with spec + code
review per task. UI tasks follow the **frontend-design** skill.

## 7. Non-goals (Phase 3)
- No agent changes (Phase 4).
- No httpOnly-cookie auth (tracked), no i18n, no SSR (pure SPA), no offline mode.
- No new backend endpoints (the Phase-2 contract is fixed; if a screen needs data the
  API doesn't expose, note it — don't silently add server routes here).

## 8. Carry-forward folded in here
- hub-api `Dockerfile` + `.env.example` + `docker-compose.yml` → Phase 3c cutover.
- Shared-DTO casing inconsistency (`PairRedeemResponse`/`DashboardMetrics` camelCase
  vs snake_case elsewhere) — the client adapts; optionally normalize in a small shared
  cleanup during 3a (decide in the 3a plan).
