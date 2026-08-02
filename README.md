# SyncHub

Self-hosted **Hub** + headless **Agents** that keep [Claude Code](https://claude.com/claude-code)
session transcripts (`~/.claude/projects/<hash>/*.jsonl`) in sync across
any number of machines — independent of Claude account, project path, or OS.

- **Hub** — always-on source of truth: a typed **NestJS + Prisma (SQLite)** API +
  WebSocket relay that also serves the **React** web UI. One process, one Docker
  image, one SQLite file. No external services required.
- **Agent** — one per machine; watches mapped folders, pushes/pulls transcripts,
  resolves conflicts. Ships as a single self-contained binary (`synchub-agent`,
  no Node.js required to run it) with an installer and OS service integration.

Everything is **realtime**: presence, sync progress, and notifications update live
over WebSocket with no page refresh.

## Architecture (TypeScript monorepo)

```
packages/shared/   zod contract — API DTOs + sync protocol + WS messages (one source of truth)
apps/hub-api/      NestJS + Prisma (SQLite): REST API, WebSocket gateway, sync engine, serves the SPA
apps/hub-web/      React + Vite + TanStack Router/Query + Tailwind/shadcn — the SPA
apps/agent/        per-machine watcher (TypeScript) + SEA single-binary build, installer, OS service
docs/              design specs + per-phase implementation plans (docs/superpowers/)
```

The Hub is a single origin: `apps/hub-api` serves `/api/*` (REST), `/ws/user` +
`/ws/agent` (WebSocket), and the built `apps/hub-web` SPA for everything else.

> The original vanilla-JS **`hub/`** and **`agent/`** have both been retired —
> fully replaced by `apps/hub-api` + `apps/hub-web` and `apps/agent` respectively.

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

## Installing the Agent (per machine)

The agent ships as a single self-contained binary — no Node.js required on the
target machine.

**Install** — one-liner (downloads the right binary from GitHub Releases):

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.sh | sh
```

```powershell
# Windows
irm https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.ps1 | iex
```

Or download the `synchub-agent` binary for your OS/arch directly from the
repo's [GitHub Releases](https://github.com/faakhir-habib/synchub/releases).
See `apps/agent/install/README.md` for pairing-during-install env vars
(`SYNCHUB_CODE` / `SYNCHUB_HUB`) and other options.

**Pair + run:**

```sh
synchub-agent pair <CODE> <HUB_URL>   # get <CODE> from the web UI: Machines → Connect machine
synchub-agent install                 # registers + starts the OS background service (systemd/launchd/Windows service)
synchub-agent status                  # confirm it's running and connected
```

Note: the single-binary build has no bundled OS-notification backend —
desktop (toast) notifications are best-effort/optional and silently no-op if
unavailable; the agent syncs fine without them.

See `apps/agent` for the agent's source, `apps/agent/service/` for the raw OS
service unit templates, and `apps/agent/install/` for the install scripts.

## Testing

```bash
pnpm lint        # eslint (flat) across the monorepo
pnpm build       # build shared → hub-web + hub-api + agent
pnpm test        # all workspace packages
```

## Status

Fully re-architected from the original vanilla-JS stack to a typed monorepo.
Backend (auth, machines/pairing, projects/mappings, the content-addressed sync
engine, conflicts, dashboard, realtime gateway), the full React SPA (dashboard,
projects, project detail, machines, conflicts, notifications, settings — all
live), and the TypeScript agent (single-binary distribution, install scripts,
OS service integration) are implemented and tested. The legacy `hub/` and
`agent/` directories have been deleted.

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the
per-phase implementation plans.
