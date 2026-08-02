# SyncHub

Self-hosted **Hub** + headless **Agents** that keep [Claude Code](https://claude.com/claude-code)
session transcripts (`~/.claude/projects/<hash>/*.jsonl`) in sync across
any number of machines — independent of Claude account, project path, or OS.

- **Hub** — always-on source of truth: a typed **NestJS + Prisma (SQLite)** API +
  WebSocket relay that also serves the **React** web UI. One process, one Docker
  image, one SQLite file. No external services required.
- **Agent** — one per machine; watches mapped folders, pushes/pulls transcripts,
  resolves conflicts. (TypeScript port + single-binary distribution: Phase 4.)

Everything is **realtime**: presence, sync progress, and notifications update live
over WebSocket with no page refresh.

## Architecture (TypeScript monorepo)

```
packages/shared/   zod contract — API DTOs + sync protocol + WS messages (one source of truth)
apps/hub-api/      NestJS + Prisma (SQLite): REST API, WebSocket gateway, sync engine, serves the SPA
apps/hub-web/      React + Vite + TanStack Router/Query + Tailwind/shadcn — the SPA
apps/agent/        per-machine watcher (TypeScript; single-binary in Phase 4)
docs/              design specs + per-phase implementation plans (docs/superpowers/)
```

The Hub is a single origin: `apps/hub-api` serves `/api/*` (REST), `/ws/user` +
`/ws/agent` (WebSocket), and the built `apps/hub-web` SPA for everything else.

> The original vanilla-JS **`hub/`** has been retired (fully replaced by
> `apps/hub-api` + `apps/hub-web`). The root-level **`agent/`** is the original
> vanilla-JS agent, kept as the current machine client until the Phase-4 TypeScript
> port replaces it.

## Quick start — development

Requires Node ≥22 and pnpm (via `corepack enable pnpm`).

```bash
pnpm install

# Backend (NestJS) — http://localhost:8080
pnpm --filter @synchub/hub-api exec prisma migrate dev   # first run: create the SQLite DB
pnpm --filter @synchub/hub-api dev

# Frontend (Vite dev server, proxies /api + /ws to :8080) — http://localhost:5173
pnpm --filter @synchub/hub-web dev
```

Then open the web app, sign up, and connect a machine (Machines → Connect).

## Quick start — self-host (Docker)

```bash
docker compose up --build      # Hub on http://localhost:8080 (API + WS + web UI)
```

Data (SQLite DB + relay store) persists in the `synchub-data` volume. See
`.env.example` for `DATABASE_URL`, `RELAY_STORE_DIR`, `PORT`, `WEB_DIST_DIR`.

## Testing

```bash
pnpm lint        # eslint (flat) across the monorepo
pnpm build       # build shared → hub-web + hub-api + agent
pnpm test        # all workspace packages
```

## Status

Re-architected from the original vanilla-JS stack to a typed monorepo. Backend
(auth, machines/pairing, projects/mappings, the content-addressed sync engine,
conflicts, dashboard, realtime gateway) and the full React SPA (dashboard, projects,
project detail, machines, conflicts, notifications, settings — all live) are
implemented and tested. Remaining: the Phase-4 agent port (TypeScript + single
binary + install script + OS service).

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the
per-phase implementation plans.
