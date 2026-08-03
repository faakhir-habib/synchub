# Contributing to SyncHub

Thanks for your interest in contributing! This document covers everything you
need to get a change from idea to merged PR.

## Getting started

### Prerequisites

- **Node.js ≥ 22** (the Hub uses the built-in `node:sqlite`)
- **pnpm 9** — enable via `corepack enable pnpm`

### Setup

```bash
git clone https://github.com/faakhir-habib/synchub.git
cd synchub
pnpm install

# First run only: create the local SQLite dev database
pnpm --filter @synchub/hub-api exec prisma migrate dev
```

### Running locally

```bash
# Backend (NestJS) — http://localhost:8080
pnpm --filter @synchub/hub-api dev

# Frontend (Vite dev server, proxies /api + /ws to :8080) — http://localhost:5173
pnpm --filter @synchub/hub-web dev

# Or both at once (builds @synchub/shared first)
pnpm dev
```

## Repository layout

```
packages/shared/   zod contract — API DTOs + sync protocol + WS messages (one source of truth)
apps/hub-api/      NestJS + Prisma (SQLite): REST API, WebSocket gateway, sync engine
apps/hub-web/      React + Vite + TanStack Router/Query + Tailwind/shadcn SPA
apps/agent/        per-machine watcher + single-binary (SEA) build, installer, OS services
docs/              design specs and per-phase implementation plans
```

Changes to API shapes, the sync protocol, or WebSocket messages belong in
`packages/shared` first — both the Hub and the Agent consume those types.

## Before you open a PR

Run the same checks CI runs:

```bash
pnpm lint        # eslint (flat config) across the monorepo
pnpm build       # build shared → hub-web + hub-api + agent
pnpm test        # all workspace test suites
pnpm format      # prettier — write formatting
```

All of these must pass. New behavior should come with tests — the codebase
keeps tests next to the source (`*.test.ts` / `*.test.tsx`) with e2e suites
under each app's `test/` directory.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(hub-api): add rate limiting to auth endpoints
fix(agent): handle ENOENT race when a watched file is deleted mid-hash
docs: clarify pairing flow in README
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
Scope by workspace where it helps (`hub-api`, `hub-web`, `agent`, `shared`).

## Pull request process

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests.
3. Ensure `pnpm lint && pnpm build && pnpm test` pass locally.
4. Open a PR against `main` describing **what** changed and **why**. Link any
   related issue.
5. CI must be green before review/merge.

For larger changes (new features, protocol changes, schema migrations), please
**open an issue first** to discuss the approach — it saves everyone time.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/faakhir-habib/synchub/issues/new/choose).
For security vulnerabilities, **do not open a public issue** — see
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
