# Phase 3b: Core Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. UI tasks MUST also load the **frontend-design** skill. Steps use checkbox (`- [ ]`).

**Goal:** Build the three core screens on the Phase-3a foundation: **Projects** (list + create + delete), **Project detail** (mappings CRUD, sync-mode, sync-now, tracked files, activity, per-project conflicts), and **Machines** (list with **live presence**, create, **pair modal**, delete) — each wired to the typed endpoints + realtime invalidation.

**Architecture:** Each screen is a route component under the persistent `_app` shell (Outlet). Data via TanStack Query (`useQuery` reads with `qk.*` keys, `useMutation` writes that invalidate the relevant keys). Live updates via the existing `RealtimeProvider` (already invalidates `qk.project(id)`, `qk.dashboardMetrics`, `qk.machines` on WS events; presence via `usePresence`). Reuse the 3a patterns: `Card`, `Skeleton`, `ErrorPanel`, `StatCard`, `PresenceDot`, `timeAgo`/`fmtBytes`, shadcn `Dialog`/`DropdownMenu`/`Table`/`Badge`.

**Tech Stack:** React 18, TanStack Router + Query, Tailwind + shadcn/ui (add `dialog`, `table`, `badge`, `alert-dialog`, `select`, `sonner` toast already present), lucide, zod (via `@synchub/shared`), Vitest + RTL.

**Available (from 3a):** `src/lib/endpoints.ts` — `listProjects/createProject/getProject/updateProject/deleteProject/setSyncMode/upsertMapping/removeMapping/syncNow/getProjectConflicts`, `listMachines/createMachine/deleteMachine/createPairCode`. `src/lib/query-keys.ts` `qk`. `src/lib/api-error.ts` `ApiError`. `src/realtime/presence-store.ts` `usePresence(machineId)`/`useAllPresence`. `sonner` `toast`. `@synchub/shared` types: `Project, ProjectDetail, ProjectCreateRequest, SyncMode, MachineWithToken, PublicMachine, PairCreateResponse`, etc. shadcn `Card/Button/Input/Label/Skeleton/DropdownMenu` exist; ADD `dialog/table/badge/select/alert-dialog` as needed.

**Conventions:** Windows PowerShell (`A && B` → `A; if ($?) { B }`); only `apps/hub-web/`; don't touch legacy `hub/`/`agent/`; `@/` alias or `.js`-relative (match neighbors); commit per task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer; keep `pnpm --filter @synchub/hub-web test` + `build` green. UI tasks: load frontend-design.

**Carry-forward from 3a to honor here:** mutations that change the projects LIST must invalidate `qk.projects` explicitly (realtime only invalidates `qk.project(id)`, not the list). Machine mutations invalidate `qk.machines`.

---

## Task 1: shadcn primitives (dialog, table, badge, select, alert-dialog)

**Files:** `apps/hub-web/src/components/ui/{dialog,table,badge,select,alert-dialog}.tsx`; add radix deps.

- [ ] **Step 1:** Add deps: `@radix-ui/react-dialog`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-select`. `pnpm --filter @synchub/hub-web install`.
- [ ] **Step 2:** Hand-add the standard shadcn source for `dialog.tsx`, `alert-dialog.tsx`, `table.tsx`, `badge.tsx`, `select.tsx` into `src/components/ui/` (they import `cn` from `@/lib/utils`, use CVA where applicable). Verify they typecheck.
- [ ] **Step 3:** `pnpm --filter @synchub/hub-web build`. Commit `feat(hub-web): shadcn dialog/table/badge/select/alert-dialog primitives`.

---

## Task 2: Projects screen (list + create + delete)

**Files:** `src/routes/Projects.tsx` (replace placeholder); `src/components/CreateProjectDialog.tsx`; test `src/routes/Projects.test.tsx`; modify `router.tsx` (projects route → real component).

- [ ] **Step 1 (frontend-design).** Failing test `Projects.test.tsx` (mock endpoints): loading → skeletons; loaded → a row/card per project (alias, sync_mode badge, created); a "New project" button opens a dialog; submitting the dialog calls `createProject` and invalidates `qk.projects` (spy the query client OR assert a refetch); a delete action (with an `AlertDialog` confirm) calls `deleteProject` + invalidates; error state on `ApiError`. Run → FAIL.
- [ ] **Step 2:** `CreateProjectDialog.tsx` — shadcn `Dialog` with an alias input + sync-mode `Select` (auto/manual/stopped, default auto); client-validate with `ProjectCreateRequest`; `useMutation(createProject)` → on success `invalidateQueries(qk.projects)` + toast + close; show `ApiError.message` (e.g. 409 duplicate alias) inline.
- [ ] **Step 3:** `Projects.tsx` — `useQuery(qk.projects, listProjects)`; render a `Table` (or card grid) of projects: alias (link to `/projects/$id`), `sync_mode` `Badge`, created (`timeAgo`), a row `DropdownMenu` (Open, Delete). Delete → `AlertDialog` confirm → `useMutation(deleteProject)` → invalidate `qk.projects` + `qk.dashboardMetrics` + toast. Loading skeletons, empty state ("No projects yet" + create CTA), error panel. `New project` button (top-right) opens the dialog. Polished per frontend-design.
- [ ] **Step 4:** `router.tsx` — the `/projects` route uses the real `Projects` (remove the placeholder import). Keep `/projects/$id` for Task 3 (add the param route now pointing to a temporary detail placeholder, or add it in Task 3).
- [ ] **Step 5:** Run test → PASS. Build. Commit `feat(hub-web): projects screen (list + create + delete)`.

---

## Task 3: Project detail screen

**Files:** `src/routes/ProjectDetail.tsx`; `src/components/{MappingRow,AddMappingDialog}.tsx`; test `src/routes/ProjectDetail.test.tsx`; `router.tsx` (`/projects/$id` route).

- [ ] **Step 1 (frontend-design).** Failing test (mock `getProject`, `listMachines`): loading → skeletons; loaded → header (alias + sync_mode + created), a stat row (tracked_files, last_sync_at via `timeAgo`), a **Sync now** button, a **sync-mode** control (Select → `setSyncMode`), a **mappings** section listing `{machine alias/name, local_path}` with add/edit/remove, an **activity** feed (`ActivityFeed` reused), and an **open conflicts** section (from `getProjectConflicts` — list only, "Resolve in Conflicts" link; full resolve UI is 3c). Error/404 handling. Run → FAIL.
- [ ] **Step 2:** `AddMappingDialog.tsx` — `Dialog` with a machine `Select` (from `listMachines` — those not yet mapped) + a `local_path` input; `useMutation(upsertMapping(projectId, machineId, {local_path}))` → invalidate `qk.project(id)` + toast. `MappingRow.tsx` — shows the machine (name + a `PresenceDot` via `usePresence(machine_id)`) + editable local_path (edit via the same dialog prefilled) + remove (`AlertDialog` → `removeMapping` → invalidate).
- [ ] **Step 3:** `ProjectDetail.tsx` — `const { id } = route params (number)`; `useQuery(qk.project(id), () => getProject(id))`; `useQuery(qk.machines, listMachines)` (for the mapping dialog). Render header, stats, Sync-now (`useMutation(syncNow(id))` → toast "Sync triggered"), sync-mode Select (`useMutation(setSyncMode(id, mode))` → invalidate `qk.project(id)` + `qk.projects`), mappings (map over `data.mappings`, `MappingRow` + Add button), activity (`ActivityFeed` from `data.activity`), conflicts (from a `useQuery(["projectConflicts",id], ()=>getProjectConflicts(id))` — list with a link to `/conflicts`). Rename/delete project (optional here; delete lives on the list — a rename inline edit is nice-to-have, keep minimal). 404 (project not owned) → a friendly not-found. Realtime already invalidates `qk.project(id)` on `changed`/`sync-complete`, so the detail updates live. Polished per frontend-design.
- [ ] **Step 4:** `router.tsx` — add/replace the `/projects/$id` route (TanStack Router param route, parse `id` to number) → `ProjectDetail`. Ensure the Projects list links navigate here (client-side, no reload).
- [ ] **Step 5:** Run test → PASS. Build. Commit `feat(hub-web): project detail (mappings, sync-mode, sync-now, activity, conflicts)`.

---

## Task 4: Machines screen (live presence + create + delete)

**Files:** `src/routes/Machines.tsx`; `src/components/CreateMachineDialog.tsx`; test `src/routes/Machines.test.tsx`; `router.tsx`.

- [ ] **Step 1 (frontend-design).** Failing test (mock `listMachines`): loading → skeletons; loaded → a row per machine with name, os, a **live presence** indicator (from `usePresence(machine.id)`, falling back to `machine.status` for the initial value), last_seen (`timeAgo`), last_ip; a "Connect machine" button (opens the create/pair flow); delete (AlertDialog → `deleteMachine` → invalidate `qk.machines`). Presence: when the presence store updates for a machine id (simulate via `setPresence`), the row's indicator flips live — assert it. Error state. Run → FAIL.
- [ ] **Step 2:** `CreateMachineDialog.tsx` — a `Dialog` with a `name` input (+ optional os/label) that calls `createMachine` and shows the returned **one-time token** (`MachineWithToken.token`) prominently with a copy button + a "you won't see this again" warning; on close invalidate `qk.machines`. (This is the direct-create path; the pairing-code flow is Task 5.)
- [ ] **Step 3:** `Machines.tsx` — `useQuery(qk.machines, listMachines)`; a `Table` of machines: name + `PresenceDot` (live via `usePresence(m.id) ?? {status:m.status}`), os/os_version, last_seen (`timeAgo(last_seen_at)`), last_ip, a row menu (Delete → AlertDialog → `deleteMachine` → invalidate `qk.machines` + `qk.dashboardMetrics`). Header: "Connect machine" button. Empty state, skeletons, error. The presence dot uses the realtime store so it flips online/offline WITHOUT a refresh (the §7.1 fix visualized). Polished per frontend-design.
- [ ] **Step 4:** `router.tsx` — `/machines` → real `Machines`.
- [ ] **Step 5:** Run test → PASS. Build. Commit `feat(hub-web): machines screen (live presence + create + delete)`.

---

## Task 5: Pair modal + verification + review

**Files:** `src/components/PairMachineDialog.tsx`; modify `Machines.tsx` (Connect flow); test; verification.

- [ ] **Step 1 (frontend-design).** Failing test: opening the pair dialog calls `createPairCode` → shows the `code` prominently + an **expiry countdown** (from `expires_in` seconds); a "generate new code" refreshes it; the agent-install hint is shown (the one-line command). Run → FAIL.
- [ ] **Step 2:** `PairMachineDialog.tsx` — `useMutation(createPairCode)` (or a query fired on open) → display the 6-char `code` in a big mono block with a copy button, a live countdown from `expires_in` (a `useEffect` timer; when it hits 0, show "expired — generate a new code"), a regenerate button, and a short "on the other machine, run: `synchub-agent pair <CODE> <hub-url>`" hint (agent CLI comes in Phase 4; the hint is informational). Close invalidates `qk.machines` (the paired machine will appear after the agent redeems — plus realtime presence will light it up).
- [ ] **Step 3:** Wire the Machines "Connect machine" button to offer both: "Pair a machine" (PairMachineDialog) and "Create manually" (CreateMachineDialog) — a small menu or two buttons.
- [ ] **Step 4:** Run test → PASS. Full verification: `pnpm --filter @synchub/hub-web test` (all pass, count), `pnpm --filter @synchub/hub-web build`, `pnpm lint` (exit 0). `git status --porcelain hub/ agent/` → EMPTY. Confirm no full-reload on nav between the new screens (structural: all under the persistent shell via `<Link>`/router).
- [ ] **Step 5:** Commit `feat(hub-web): pair machine modal + connect flow`. Orchestrator runs a Phase-3b review.

---

## Self-Review (author checklist — completed)
- **Spec coverage (design §4/§6-3b):** Projects list+create+delete (Task 2); Project detail w/ mappings, sync-mode, sync-now, activity, conflicts (Task 3); Machines w/ live presence, create, delete (Task 4); pair modal + connect flow (Task 5). shadcn primitives (Task 1).
- **Realtime wiring:** presence dots via `usePresence` (live, no refresh); `qk.project(id)` auto-invalidated by RealtimeProvider; mutations explicitly invalidate `qk.projects`/`qk.machines` (the 3a carry-forward).
- **Reuse:** ActivityFeed, StatCard, Skeleton, ErrorPanel, PresenceDot, timeAgo/fmtBytes, the loading/error/empty patterns from 3a.
- **frontend-design** on every screen task.
- **Deferred to 3c:** Conflicts resolve UI, Notifications screen, Settings/profile, full progress toasts, legacy delete + docker-compose.
