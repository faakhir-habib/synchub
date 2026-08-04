# SyncHub

[![CI](https://github.com/faakhir-habib/synchub/actions/workflows/ci.yml/badge.svg)](https://github.com/faakhir-habib/synchub/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/faakhir-habib/synchub)](https://github.com/faakhir-habib/synchub/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

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

The agent is a single self-contained binary — no Node.js required. On each
machine, the whole flow is **install → pair → pick a folder**. `<HUB_URL>` is
your Hub, e.g. `https://synchub.example.com`.

### 1. Install

**Windows** — run in an **Administrator** PowerShell:

```powershell
irm https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.ps1 | iex
```

**macOS / Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.sh | sh
```

The installer does everything: downloads the binary from [GitHub Releases](https://github.com/faakhir-habib/synchub/releases),
adds it to your `PATH`, and **registers + starts the background service**
(auto-starts on every boot). The service comes up in a *"waiting for pairing"*
state — that's expected; it starts syncing the moment you pair (step 2).

> Windows runs the service as `SYSTEM`, which is why the installer needs an
> **Administrator** shell. macOS/Linux use a per-user service — no admin needed.
> (Not elevated on Windows? The binary still installs; just run
> `synchub-agent install` from an Administrator PowerShell afterward.)

**To upgrade**, just re-run the same install command — it overwrites the
binary *and* restarts the already-running service against it, so the update
takes effect immediately. No need to uninstall first, no reboot.

### 2. Pair — the only manual step

Get a code from the Hub UI (**Machines → Connect machine**; sign up first on a
fresh Hub), then in any terminal:

```
synchub-agent pair <CODE> <HUB_URL>
```

The already-running service picks it up instantly and starts syncing — no
restart, no reboot.

### 3. Choose what to sync (Hub UI)

Create a **Project** and **map it to this machine** with the path to a Claude
Code transcript folder, sync mode **auto**:

```
macOS / Linux :  ~/.claude/projects/<project-folder>
Windows       :  C:\Users\<you>\.claude\projects\<project-folder>
```

The agent watches that folder's `*.jsonl` files. Map the **same** Project on
your other machines to sync transcripts across all of them.

That's it — repeat **install → pair → map** on each machine.

### Managing it

- **Check state:** `synchub-agent status` (on Windows, from an **Administrator**
  shell — a normal shell can't see the `SYSTEM` service and will report it as
  not installed).
- **Notifications:** the single binary has no bundled toast backend — desktop
  notifications are optional and no-op if unavailable; sync works without them.

### Uninstall — one command, completely removes it

Removes the background service, the binary, the PATH entry, and
`~/.synchub/` (pairing + sync state) in one shot.

**Windows** — run in an **Administrator** PowerShell:

```powershell
irm https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/uninstall.ps1 | iex
```

**macOS / Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/uninstall.sh | sh
```

Reinstalling right after and want to keep the existing pairing instead of
wiping it? Pass `-KeepData` (`install.ps1`) or `--keep-data` (`install.sh`).
See `apps/agent/install/README.md` for details.

See `apps/agent/install/README.md` for options like `SYNCHUB_VERSION` (pin a
release), `apps/agent/service/` for the raw OS service templates, and
`apps/agent` for the source.

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

SyncHub is pre-1.0 and designed for self-hosting by a single user or a small
trusted group — see the hardening notes in [SECURITY.md](SECURITY.md) before
exposing a Hub to the public internet.

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the
per-phase implementation plans.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
setup, test commands, and PR process. Please report security issues privately
per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Faakhir Habib
