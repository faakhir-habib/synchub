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

The agent is a single self-contained binary — no Node.js required on the target.
Do these steps on **every machine** whose transcripts you want to sync. Below,
`<HUB_URL>` is your Hub, e.g. `https://synchub.mylogiclab.cloud`.

### 1. Install the binary

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.sh | sh
```

```powershell
# Windows
irm https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.ps1 | iex
```

The installer downloads the right binary from [GitHub Releases](https://github.com/faakhir-habib/synchub/releases),
puts it on your `PATH`, and prints the next steps. **Open a new terminal
afterward** so the updated `PATH` is picked up. Verify:

```
synchub-agent --version
```

(Prefer a manual download? Grab `synchub-agent-<os>-<arch>` from Releases and
put it on your `PATH` yourself. `apps/agent/install/README.md` documents extra
options like `SYNCHUB_VERSION` to pin a release.)

### 2. Get a pairing code (web UI)

Open `<HUB_URL>` in a browser. **First machine on a fresh Hub:** sign up.
**Additional machines:** just log in. Then go to **Machines → Connect machine**
and copy the pairing code.

### 3. Pair this machine

```
synchub-agent pair <CODE> <HUB_URL>
synchub-agent status                 # -> "Paired to <HUB_URL> as machine #N"
```

### 4. Choose what to sync (web UI)

In the UI, create a **Project**, then **map it to this machine** with the local
path to a Claude Code transcript folder, and set **sync mode = auto**:

```
macOS / Linux :  ~/.claude/projects/<project-folder>
Windows       :  C:\Users\<you>\.claude\projects\<project-folder>
```

The agent watches that folder's `*.jsonl` files. One Project ↔ one folder; add
more mappings for more folders. To sync the **same** project across machines,
map each machine's local copy of that folder to the same Project.

### 5. Test it (foreground)

```
synchub-agent run
```

You should see it push the transcripts; they appear live in the Hub's project
view. Press `Ctrl-C` to stop, then set up the background service below.

### 6. Run it in the background (boot service)

**macOS / Linux:**

```
synchub-agent install                # systemd --user / launchd — starts now and on every boot
synchub-agent status                 # -> "Service: installed, running"
```

**Windows** — `install` registers a Session-0 boot service (runs as `SYSTEM`),
so it **must be run from an elevated (Administrator) PowerShell**:

```powershell
# In an Administrator PowerShell:
synchub-agent install                        # registers the boot task
Start-ScheduledTask -TaskName SyncHubAgent   # start it now (otherwise it starts at next boot)
synchub-agent status                         # -> "Service: installed, running"
```

> **Windows notes**
> - `install`, `uninstall`, and `Start-ScheduledTask` require an **elevated**
>   shell (the service runs as `SYSTEM`).
> - `synchub-agent status` in a **normal** (non-admin) shell will report
>   *"Service: not installed"* even when it is — a non-admin process can't see a
>   `SYSTEM` task. Check service state from an **elevated** shell.

That's it — the agent now syncs continuously in the background and auto-starts
on boot. Repeat steps 1–6 on your other machines to sync across all of them.

### Uninstalling

```
synchub-agent uninstall              # removes the OS service (elevated PowerShell on Windows)
```

Then remove the binary and its config to fully clean up:

```
# binary:  macOS/Linux  /usr/local/bin/synchub-agent  (or ~/.local/bin/synchub-agent)
#          Windows      %LOCALAPPDATA%\Programs\SyncHub\synchub-agent.exe
# config:  ~/.synchub/   (config.json, state.json, tombstones.json)
```

**Notifications:** the single-binary build has no bundled OS-notification
backend — desktop (toast) notifications are best-effort/optional and silently
no-op if unavailable; the agent syncs fine without them.

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
