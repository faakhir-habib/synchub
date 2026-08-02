# Phase 3a: Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. UI tasks MUST also load the **frontend-design** skill for visual quality. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the React SPA foundation in `apps/hub-web`: Tailwind + shadcn/ui + dark/light theme, a typed API client + endpoints (via `@synchub/shared`), auth (login/signup + protected routing), a persistent app-shell (sidebar/topbar that mounts once — the no-refresh fix), a `RealtimeProvider` (WS connect + backoff-reconnect + message → query-invalidation dispatch), and a real Dashboard wired to the backend proving the whole pipeline.

**Architecture:** Providers in `main.tsx` (QueryClient → Theme → Auth → Router; Realtime lives inside the authed shell). TanStack Router route tree: public `/login` `/signup`, protected app subtree under the shell. TanStack Query owns server state; `RealtimeProvider` invalidates queries on WS events. All API responses parsed through shared zod schemas.

**Tech Stack:** React 18, Vite 6, TS, TanStack Router + Query (already deps), Tailwind CSS 3, shadcn/ui (Radix + CVA + tailwind-merge), lucide-react, zod (via `@synchub/shared`), Vitest + React Testing Library (already wired) — component tests with mocked fetch/WS, plus build.

**Backend contract:** hub-api serves `/api/*` (see `@synchub/shared` DTOs) + WS `/ws/user?token=`. During dev, Vite proxies `/api` + `/health` + `/ws` to `localhost:8080` (proxy exists for `/api`+`/health`; add `/ws` in Task 1).

**Conventions:** Windows PowerShell (`A && B` → `A; if ($?) { B }`); don't touch legacy `hub/`/`agent/`; only `apps/hub-web/` (+ maybe a tiny `@synchub/shared` casing tweak if the plan calls it out). `.js` import extensions on local TS. Commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Keep `pnpm --filter @synchub/hub-web test` + `pnpm --filter @synchub/hub-web build` green after each task. UI tasks: load the **frontend-design** skill first.

**Current state:** `apps/hub-web` skeleton has `main.tsx`, `router.tsx` (Dashboard + Projects stub routes), `shell/AppShell.tsx` (inline-styled), `routes/Dashboard.tsx` (calls `/health`), `lib/api.ts` (getHealth). These placeholders are REPLACED here.

---

## Task 1: Tailwind + shadcn/ui + theme + Vite/ws proxy

**Files:** `apps/hub-web/{tailwind.config.ts,postcss.config.js}`, `apps/hub-web/src/styles/index.css`, `apps/hub-web/components.json` (shadcn), `apps/hub-web/src/lib/utils.ts` (cn helper), theme provider `apps/hub-web/src/theme/theme-provider.tsx`; modify `vite.config.ts`, `main.tsx`, `tsconfig.json` (path alias `@/`).

- [ ] **Step 1 (load frontend-design skill first).** Add deps to `apps/hub-web`: `tailwindcss@^3.4` `postcss` `autoprefixer` (dev); `class-variance-authority` `clsx` `tailwind-merge` `lucide-react` `@radix-ui/react-slot` (runtime — shadcn primitives get added per component as needed). `pnpm --filter @synchub/hub-web install`. Init Tailwind (`npx tailwindcss init -p` or hand-write configs).
- [ ] **Step 2:** `tailwind.config.ts` with `content: ["./index.html","./src/**/*.{ts,tsx}"]`, `darkMode: "class"`, and the shadcn theme extension (CSS-variable-driven colors: background/foreground/card/primary/muted/border/etc.). `src/styles/index.css`: `@tailwind base/components/utilities` + the shadcn `:root` (light) and `.dark` CSS-variable token blocks. Import `styles/index.css` in `main.tsx`.
- [ ] **Step 3:** `src/lib/utils.ts` → `export function cn(...inputs) { return twMerge(clsx(inputs)); }`. `components.json` for shadcn config (style: default, tailwind css path, alias `@/components`). `tsconfig.json` + `vite.config.ts`: add `@/*` → `src/*` path alias.
- [ ] **Step 4:** `theme/theme-provider.tsx` — a context that toggles `document.documentElement.classList` `dark`/`light`, persists to `localStorage`, defaults to system (`prefers-color-scheme`). Provide a `useTheme()` hook. Wrap the app in `main.tsx`.
- [ ] **Step 5:** `vite.config.ts` — add `/ws` to the dev proxy (`"/ws": { target: "ws://localhost:8080", ws: true }`) alongside the existing `/api` + `/health`.
- [ ] **Step 6:** Add a couple of base shadcn components now so later tasks have them: run/copy `button`, `input`, `card`, `label` into `src/components/ui/` (shadcn CLI `npx shadcn@latest add button input card label` OR hand-add the standard component source). Verify they compile.
- [ ] **Step 7:** `pnpm --filter @synchub/hub-web build` (tailwind compiles, no errors) + `pnpm --filter @synchub/hub-web test` (existing test may need the placeholder removed later; keep green or update). Commit `feat(hub-web): tailwind + shadcn + theme + ws proxy`.

---

## Task 2: Typed API client + endpoints + query keys

**Files:** replace `apps/hub-web/src/lib/api.ts`; create `src/lib/{endpoints.ts,query-keys.ts,api-error.ts}`. Test: `src/lib/endpoints.test.ts`.

- [ ] **Step 1: Failing test** `endpoints.test.ts` (Vitest, mock `global.fetch`): assert `api.get`/`api.post` attach `Authorization: Bearer <token>` when a token is set, parse a JSON body through a passed zod schema (return typed data), and throw a typed `ApiError { error, code, status }` on a non-2xx `{error,code}` body. Assert an endpoint fn like `getDashboardMetrics()` calls `/api/dashboard/metrics` and returns a `DashboardMetrics`-typed object (mock the response).
- [ ] **Step 2: `api-error.ts`** — `export class ApiError extends Error { constructor(public status:number, public code:string, message:string){...} }`.
- [ ] **Step 3: `api.ts`** — a small client: holds an in-memory auth token (settable via `setАuthToken`), `request(method, path, {body?, schema?})` → `fetch("/api"+path or path, {headers})`; on non-2xx parse `{error,code}` (fall back to status) → throw `ApiError`; on 2xx, if `schema` given `schema.parse(await res.json())` else return json/void. Export `get/post/put/del` helpers.
- [ ] **Step 4: `endpoints.ts`** — typed functions per resource using `@synchub/shared` schemas: auth (`login`, `signup`, `me`, `updateProfile`, `setWebhook`, `logout`), projects (`listProjects`, `createProject`, `getProject`, `updateProject`, `deleteProject`, `setSyncMode`, `upsertMapping`, `removeMapping`, `syncNow`, `getProjectConflicts`), machines (`listMachines`, `createMachine`, `deleteMachine`, `createPairCode`), conflicts (`listConflicts`, `resolveConflict`), notifications (`listNotifications`, `markRead`, `markAllRead`), dashboard (`getMetrics`, `getActivity`). Each returns the shared-typed shape (parse with the schema). Note the DTO casing: use the field names exactly as `@synchub/shared` defines them.
- [ ] **Step 5: `query-keys.ts`** — a `qk` object of stable key factories: `qk.me`, `qk.dashboardMetrics`, `qk.activity`, `qk.projects`, `qk.project(id)`, `qk.machines`, `qk.conflicts`, `qk.notifications`.
- [ ] **Step 6:** Run test → PASS. Build. Commit `feat(hub-web): typed api client + endpoints + query keys`.

---

## Task 3: Auth — context, login, signup, protected routing

**Files:** `src/auth/{auth-context.tsx,Login.tsx,Signup.tsx}`; modify `router.tsx`, `main.tsx`. Test: `src/auth/auth.test.tsx`.

- [ ] **Step 1: Failing test** `auth.test.tsx` (RTL, mock endpoints): rendering `<Login/>` and submitting valid creds calls `login`, stores the token, and sets the user; an invalid login shows the `ApiError` message; `useAuth()` exposes `{ user, token, login, signup, logout }`; logout clears token + user.
- [ ] **Step 2: `auth-context.tsx`** — token in `localStorage` (`synchub_token`) + in-memory; on mount, if a token exists, `setAuthToken` then `me()` to hydrate the user (401 → clear). `login(email,pw)`/`signup(...)` call the endpoints, store token, set user, `setAuthToken`. `logout()` calls `POST /logout` best-effort, clears token+user+`setAuthToken(null)`. Expose `useAuth()`. A `isLoading` flag while the initial `me()` resolves.
- [ ] **Step 3: `Login.tsx` + `Signup.tsx`** — shadcn `Card`/`Input`/`Button`/`Label` forms (FOLLOW the frontend-design skill — polished, centered auth card, brand mark, dark/light aware). Client-side validate with the shared `LoginRequest`/`SignupRequest` zod schemas; show field + server errors. On success, navigate to `/`.
- [ ] **Step 4: protected routing** in `router.tsx` — a `beforeLoad`/guard on the app route subtree: if `!token`, redirect to `/login`; `/login`+`/signup` are public and redirect to `/` if already authed. Wrap providers in `main.tsx` (QueryClient → Theme → Auth → Router). Handle the `isLoading` splash (don't flash /login before `me()` resolves).
- [ ] **Step 5:** Run test → PASS. Build. Commit `feat(hub-web): auth (context, login, signup, protected routes)`.

---

## Task 4: Persistent AppShell (sidebar + topbar)

**Files:** replace `src/shell/AppShell.tsx`; create `src/shell/{Sidebar.tsx,Topbar.tsx}`; `src/components/PresenceDot.tsx`. Test: `src/shell/AppShell.test.tsx`.

- [ ] **Step 1 (load frontend-design skill).** Failing test `AppShell.test.tsx`: the shell renders the sidebar nav links (Dashboard, Projects, Machines, Conflicts, Notifications, Settings) + topbar (user chip, theme toggle, logout); an `<Outlet/>` region is present; navigating between two child routes does NOT unmount the shell (assert the shell DOM node persists across a route change — TanStack Router memory history in the test).
- [ ] **Step 2: `Sidebar.tsx`** — brand + nav (TanStack `<Link>`, active state), a bottom account link. `Topbar.tsx` — page title slot, notifications bell (with an unread badge placeholder — wired live in 3c), theme toggle (`useTheme`), user dropdown (shadcn `DropdownMenu`: profile, logout). `AppShell.tsx` — `flex` layout: persistent Sidebar + main (Topbar + `<Outlet/>`), mounts once. Design: polished, responsive (sidebar collapses on mobile), dark/light aware — FOLLOW frontend-design.
- [ ] **Step 3: `PresenceDot.tsx`** — a small online/offline indicator component (used by machines + sidebar status later).
- [ ] **Step 4:** Run test → PASS. Build. Commit `feat(hub-web): persistent app-shell (sidebar + topbar)`.

---

## Task 5: RealtimeProvider (WS connect + reconnect + dispatch)

**Files:** `src/lib/ws.ts`, `src/realtime/realtime-provider.tsx`, `src/realtime/presence-store.ts`. Test: `src/realtime/realtime.test.tsx`.

- [ ] **Step 1: Failing test** `realtime.test.tsx` (mock `WebSocket` with a fake that lets the test push messages): mounting `RealtimeProvider` (with a token) opens a socket to `/ws/user?token=`; on a `presence` message the presence store updates (a `usePresence(machineId)` hook reflects online/offline); on a `changed` message `queryClient.invalidateQueries` is called for the project key; on `notification` a toast fires + notifications query invalidated; on socket close, a reconnect is scheduled (assert a new socket is created after the backoff — use fake timers). On (re)connect, all queries are invalidated (catch-up).
- [ ] **Step 2: `ws.ts`** — `createRealtimeSocket({ token, onMessage, onOpen, onClose })`: builds `${wsProto}://${host}/ws/user?token=`, parses incoming frames with the `@synchub/shared` `WsMessage` schema (ignore parse failures), calls `onMessage(msg)`. Exposes `close()`.
- [ ] **Step 3: `presence-store.ts`** — a tiny store (Zustand OR a React context + `useSyncExternalStore`; prefer a minimal context+ref to avoid a new dep, or add `zustand` if cleaner — decide and note) mapping `machineId → {status,lastSeenAt}`; `usePresence(machineId)` + `setPresence`.
- [ ] **Step 4: `realtime-provider.tsx`** — inside the authed shell: opens ONE socket (via `ws.ts`) using the auth token; **reconnect with exponential backoff** (cap ~30s; reset on stable open); on each `WsMessage` dispatch: `presence`→presence store; `changed`→`invalidateQueries(qk.project(projectId))` + `qk.dashboardMetrics` + `qk.activity`; `sync-progress`/`sync-complete`→ (a light progress signal — a toast or a query invalidate; full UI in 3b/3c); `notification`→ `toast` + `invalidateQueries(qk.notifications)`; on open/reconnect → `invalidateQueries()` (all) to catch up. Provide a `useRealtimeStatus()` (connected/reconnecting) for the topbar.
- [ ] **Step 5:** Run test → PASS. Build. Commit `feat(hub-web): realtime provider (ws connect, backoff reconnect, dispatch)`.

---

## Task 6: Real Dashboard (prove the pipeline) + remove placeholders

**Files:** replace `src/routes/Dashboard.tsx`; delete the Phase-1 `Projects` stub + old `Dashboard.test.tsx` (replace); create `src/components/{StatCard.tsx,ActivityFeed.tsx,Skeleton.tsx}` (or use shadcn skeleton). Test: `src/routes/Dashboard.test.tsx` (new).

- [ ] **Step 1 (frontend-design skill).** Failing test: `<Dashboard/>` with mocked `getMetrics`/`getActivity` renders the metric tiles (active projects, connected machines, open conflicts, sync success rate) with real values, a recent-activity list, and shows **skeletons** while loading (not a "—" flash); an error state renders on `ApiError`.
- [ ] **Step 2:** `StatCard.tsx` (shadcn Card-based tile with icon, label, value, foot), `ActivityFeed.tsx`, a `Skeleton` (shadcn). Design: polished stat grid mirroring the legacy dashboard's information but modern — FOLLOW frontend-design.
- [ ] **Step 3:** `Dashboard.tsx` — `useQuery(qk.dashboardMetrics, getMetrics)` + `useQuery(qk.activity, ()=>getActivity(20))`; render tiles + activity; loading skeletons; error state. Uses the `DashboardMetrics` shared type.
- [ ] **Step 4:** Update `router.tsx`: the index route → the new Dashboard under the shell; remove the placeholder `Projects` stub route (a real one lands in 3b — leave a minimal placeholder route or omit until 3b; if omitted, ensure the sidebar Projects link is present but its route is added in 3b — simplest: keep a tiny "Projects (coming in 3b)" placeholder page so nav doesn't 404). Delete the old health-based Dashboard test.
- [ ] **Step 5:** Run test → PASS. `pnpm --filter @synchub/hub-web build`. Manual/integration note: with hub-api running (`pnpm --filter @synchub/hub-api dev`) + `pnpm --filter @synchub/hub-web dev`, logging in shows a live dashboard and navigating does NOT full-reload — confirm structurally (single RouterProvider + Links). Commit `feat(hub-web): real dashboard wired to api + presence, remove placeholders`.

---

## Task 7: Verification + review

- [ ] **Step 1:** `pnpm --filter @synchub/hub-web test` (all pass, report count), `pnpm --filter @synchub/hub-web build`, monorepo `pnpm lint && pnpm build && pnpm test` (all green — report per-package). `git status --porcelain hub/ agent/` → EMPTY.
- [ ] **Step 2:** Confirm the no-refresh property structurally (one `RouterProvider` + `<Link>` nav + shell mounts once) and that the realtime socket opens once inside the shell. Summarize.
- [ ] **Step 3:** Commit any final wiring. Orchestrator runs a Phase-3a foundation review.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §3/§5/§6-3a):** Tailwind+shadcn+theme (Task 1); typed api client + endpoints via @synchub/shared (Task 2); auth + protected routing (Task 3); persistent shell = no-refresh (Task 4); RealtimeProvider WS + backoff-reconnect + invalidation dispatch (Task 5); real Dashboard proving the pipeline (Task 6). Loading skeletons replace the "—" flash (Task 6).
- **frontend-design skill** invoked on every UI task (1, 3, 4, 6).
- **Deferred to 3b/3c:** projects/project-detail/machines (3b); conflicts/notifications/settings + full progress UI + legacy delete + docker-compose (3c).
- **Testing reality:** component tests with mocked fetch/WS + build (no full e2e against a live server in unit tests); a manual dev-run note for the true end-to-end no-refresh confirmation.
- **Type/naming:** `qk` keys (Task 5 consumes Task 5's own + Task 2's); `ApiError`/`api`/`endpoints` (Task 2) consumed by auth (3), realtime (5), dashboard (6); shared DTO field names used verbatim (note the camelCase DTOs).
