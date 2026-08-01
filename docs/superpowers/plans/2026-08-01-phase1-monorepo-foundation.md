# Phase 1: Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a TypeScript pnpm monorepo skeleton (shared contract + hub-api + hub-web + agent) that builds end-to-end and proves the typed pipeline, without touching the existing `hub/` and `agent/` apps.

**Architecture:** A pnpm-workspace monorepo. `packages/shared` holds zod schemas + inferred types (the API/protocol contract) and compiles to `dist/`. `apps/hub-api` (NestJS) and `apps/hub-web` (React+Vite) both depend on `@synchub/shared` via `workspace:*`. A minimal `apps/agent` TS CLI is scaffolded for Phase 4. Prisma models are translated 1:1 from the current `hub/src/schema.sql` (+ db.js migrations). The old `hub/` and `agent/` directories are left running as-is.

**Tech Stack:** pnpm workspaces, TypeScript (strict), zod, NestJS + Prisma (SQLite), React + Vite + TanStack Router/Query, Vitest, ESLint (flat) + Prettier, GitHub Actions.

**Reference (existing code to translate, do NOT modify):**
- `hub/src/schema.sql` + `hub/src/db.js` → Prisma models
- `hub/src/routes/agent.js` → sync-protocol shapes (`manifest`/`pull`/`push`)
- `hub/src/lib/realtime.js` → WebSocket message shapes

**Environment note:** Node v24 and corepack are installed; pnpm is provided via corepack (Task 1). All commands assume repo root `C:\projects\synchub`. Bash tool syntax shown; on PowerShell adapt env-var syntax.

---

## File Structure (created in this phase)

```
synchub/
├── package.json                     # root: private, workspace scripts, packageManager
├── pnpm-workspace.yaml              # workspace globs
├── .npmrc                           # pnpm settings
├── tsconfig.base.json               # shared strict TS config
├── eslint.config.mjs                # flat ESLint config (root)
├── .prettierrc.json
├── .github/workflows/ci.yml         # lint + build + test on PR
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts             # re-exports
│       │   ├── api.ts               # API DTO schemas
│       │   ├── sync.ts              # sync-protocol schemas
│       │   └── ws.ts                # websocket message schemas
│       └── test/schemas.test.ts     # round-trip zod tests (Vitest)
├── apps/
│   ├── hub-api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── prisma/schema.prisma     # 1:1 translation of schema.sql
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── prisma/prisma.module.ts
│   │   │   ├── prisma/prisma.service.ts
│   │   │   └── health/health.controller.ts
│   │   └── test/health.e2e.test.ts
│   ├── hub-web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── router.tsx
│   │       ├── lib/api.ts           # typed fetch client (uses @synchub/shared)
│   │       ├── shell/AppShell.tsx
│   │       └── routes/Dashboard.tsx
│   └── agent/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/cli.ts               # `--version`
```

---

## Task 1: Root workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`
- Modify: `.gitignore`

- [ ] **Step 1: Enable pnpm via corepack**

Run:
```bash
corepack enable pnpm && corepack prepare pnpm@9.15.0 --activate && pnpm --version
```
Expected: prints `9.15.0`.

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 3: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "synchub",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r --sort build",
    "test": "pnpm -r test",
    "lint": "eslint .",
    "format": "prettier --write .",
    "dev": "pnpm --filter @synchub/shared build && pnpm --parallel --filter ./apps/hub-api --filter ./apps/hub-web dev"
  },
  "devDependencies": {
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.19.0"
  }
}
```

- [ ] **Step 5: Append to `.gitignore`**

Add these lines to the existing `.gitignore`:
```
# monorepo
node_modules/
dist/
apps/**/dist/
packages/**/dist/
apps/hub-web/dist/
apps/hub-api/prisma/*.db
.turbo/
```

- [ ] **Step 6: Install and verify workspace is recognized**

Run:
```bash
pnpm install
```
Expected: completes without error; creates root `node_modules` and `pnpm-lock.yaml`. (No workspace packages exist yet — that is fine.)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml .npmrc .gitignore pnpm-lock.yaml
git commit -m "chore(monorepo): pnpm workspace scaffold"
```

---

## Task 2: Shared TS config + linting/formatting

**Files:**
- Create: `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`

- [ ] **Step 1: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 2: Create `.prettierrc.json`**

```json
{
  "printWidth": 100,
  "singleQuote": false,
  "trailingComma": "all",
  "semi": true
}
```

- [ ] **Step 3: Create `eslint.config.mjs`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "hub/**", "agent/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
```

Note: the `ignores` deliberately excludes the legacy `hub/` and `agent/` dirs — Phase 1 does not lint them.

- [ ] **Step 4: Install the ESLint core preset**

Run:
```bash
pnpm add -w -D @eslint/js
```
Expected: adds `@eslint/js` to root devDependencies.

- [ ] **Step 5: Verify lint runs (no files yet → passes clean)**

Run:
```bash
pnpm lint
```
Expected: exits 0 with no errors.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.base.json eslint.config.mjs .prettierrc.json package.json pnpm-lock.yaml
git commit -m "chore(monorepo): shared tsconfig, eslint (flat), prettier"
```

---

## Task 3: `packages/shared` — typed contract (zod schemas)

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/{index,api,sync,ws}.ts`
- Test: `packages/shared/test/schemas.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@synchub/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.24.1" },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/sync.ts` (sync-protocol shapes from `hub/src/routes/agent.js`)**

```ts
import { z } from "zod";

// GET /manifest/:projectId → array of these
export const ManifestEntry = z.object({
  filename: z.string(),
  hash: z.string(),
  size: z.number().int().nonnegative(),
  updated_at: z.string(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

// POST /push/:projectId body
export const PushRequest = z.object({
  filename: z.string(),
  content: z.string(),
  base_hash: z.string().nullable().default(null),
});
export type PushRequest = z.infer<typeof PushRequest>;

// POST /push/:projectId response
export const PushResponse = z.object({
  status: z.enum(["accepted", "unchanged", "merged", "behind", "conflict"]),
  hash: z.string().optional(),
  conflictId: z.number().int().optional(),
});
export type PushResponse = z.infer<typeof PushResponse>;

// GET /mappings → array of these
export const AgentMapping = z.object({
  project_id: z.number().int(),
  machine_id: z.number().int(),
  local_path: z.string(),
  alias: z.string().nullable(),
  sync_mode: z.enum(["auto", "manual", "stopped"]),
});
export type AgentMapping = z.infer<typeof AgentMapping>;
```

- [ ] **Step 4: Create `packages/shared/src/ws.ts` (from `hub/src/lib/realtime.js`)**

```ts
import { z } from "zod";

export const WsWelcome = z.object({
  type: z.literal("welcome"),
  machineId: z.number().int().optional(),
  userId: z.number().int().optional(),
});

export const WsChanged = z.object({
  type: z.literal("changed"),
  projectId: z.number().int(),
  filename: z.string(),
  hash: z.string(),
});

export const WsSync = z.object({
  type: z.literal("sync"),
  projectId: z.number().int(),
});

export const WsNotification = z.object({
  type: z.literal("notification"),
  notification: z.object({
    type: z.string(),
    title: z.string(),
    body: z.string().nullable().optional(),
  }),
});

export const WsMessage = z.discriminatedUnion("type", [
  WsWelcome,
  WsChanged,
  WsSync,
  WsNotification,
]);
export type WsMessage = z.infer<typeof WsMessage>;
```

- [ ] **Step 5: Create `packages/shared/src/api.ts` (API DTOs + typed error shape)**

```ts
import { z } from "zod";

export const ApiError = z.object({ error: z.string(), code: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;

export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
  db: z.enum(["up", "down"]),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// Auth
export const SignupRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const MeResponse = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string().nullable(),
  notify_conflicts: z.boolean(),
  notify_sync: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// Core resources (shapes mirror hub/src/schema.sql rows)
export const Project = z.object({
  id: z.number().int(),
  alias: z.string(),
  sync_mode: z.enum(["auto", "manual", "stopped"]),
  created_at: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Machine = z.object({
  id: z.number().int(),
  name: z.string(),
  os: z.string().nullable(),
  status: z.enum(["online", "offline"]),
  last_seen_at: z.string().nullable(),
});
export type Machine = z.infer<typeof Machine>;

export const Conflict = z.object({
  id: z.number().int(),
  project_id: z.number().int(),
  filename: z.string(),
  status: z.enum(["open", "resolved"]),
  auto_merged: z.boolean(),
  created_at: z.string(),
});
export type Conflict = z.infer<typeof Conflict>;

export const NotificationsSummary = z.object({
  unread: z.number().int(),
  items: z.array(
    z.object({
      id: z.number().int(),
      type: z.string(),
      title: z.string(),
      body: z.string().nullable(),
      read: z.boolean(),
      created_at: z.string(),
    }),
  ),
});
export type NotificationsSummary = z.infer<typeof NotificationsSummary>;
```

- [ ] **Step 6: Create `packages/shared/src/index.ts`**

```ts
export * from "./api.js";
export * from "./sync.js";
export * from "./ws.js";
```

- [ ] **Step 7: Write the failing test `packages/shared/test/schemas.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { HealthResponse, PushResponse, WsMessage } from "../src/index.js";

describe("shared schemas round-trip", () => {
  it("accepts a valid HealthResponse", () => {
    const ok = HealthResponse.parse({ status: "ok", version: "0.1.0", db: "up" });
    expect(ok.status).toBe("ok");
  });

  it("rejects an invalid PushResponse status", () => {
    const r = PushResponse.safeParse({ status: "banana" });
    expect(r.success).toBe(false);
  });

  it("discriminates a WsChanged message", () => {
    const msg = WsMessage.parse({
      type: "changed",
      projectId: 1,
      filename: "a.jsonl",
      hash: "abc",
    });
    expect(msg.type).toBe("changed");
  });
});
```

- [ ] **Step 8: Install deps for shared**

Run:
```bash
pnpm --filter @synchub/shared install
```
Expected: installs zod, vitest, typescript into the workspace.

- [ ] **Step 9: Run tests to verify they fail (schemas not built/typed yet if any error), then pass**

Run:
```bash
pnpm --filter @synchub/shared test
```
Expected: 3 tests PASS. If a TS import path error appears, confirm all `src/*.ts` files exist and use `.js` extensions in imports (NodeNext requirement).

- [ ] **Step 10: Build shared to dist**

Run:
```bash
pnpm --filter @synchub/shared build
```
Expected: creates `packages/shared/dist/index.js` + `.d.ts`.

- [ ] **Step 11: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): zod contract for api, sync protocol, ws messages"
```

---

## Task 4: `apps/hub-api` — NestJS skeleton + typed `/health`

**Files:**
- Create: `apps/hub-api/{package.json,tsconfig.json,nest-cli.json}`
- Create: `apps/hub-api/src/{main.ts,app.module.ts,health/health.controller.ts}`
- Test: `apps/hub-api/test/health.e2e.test.ts`

- [ ] **Step 1: Create `apps/hub-api/package.json`**

```json
{
  "name": "@synchub/hub-api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "@prisma/client": "^6.1.0",
    "@synchub/shared": "workspace:*",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.9",
    "@nestjs/testing": "^10.4.15",
    "prisma": "^6.1.0",
    "supertest": "^7.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/hub-api/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 3: Create `apps/hub-api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "CommonJS",
    "target": "ES2022",
    "moduleResolution": "node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "outDir": "./dist",
    "baseUrl": "./"
  },
  "include": ["src"]
}
```

Note: NestJS uses CommonJS + decorators, so this tsconfig intentionally does NOT extend the NodeNext base. It still imports `@synchub/shared` (an ESM package) via NestJS/Node interop.

- [ ] **Step 4: Create `apps/hub-api/src/health/health.controller.ts`**

```ts
import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@synchub/shared";

@Controller("health")
export class HealthController {
  @Get()
  get(): HealthResponse {
    return { status: "ok", version: "0.1.0", db: "up" };
  }
}
```

- [ ] **Step 5: Create `apps/hub-api/src/app.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";

@Module({
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: Create `apps/hub-api/src/main.ts`**

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`SyncHub hub-api on :${port}`);
}
bootstrap();
```

- [ ] **Step 7: Write the failing e2e test `apps/hub-api/test/health.e2e.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { HealthResponse } from "@synchub/shared";

let app: INestApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns a valid HealthResponse", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    // Validates the response against the SHARED contract:
    const parsed = HealthResponse.parse(res.body);
    expect(parsed.status).toBe("ok");
  });
});
```

- [ ] **Step 8: Install deps**

Run:
```bash
pnpm --filter @synchub/hub-api install
```
Expected: installs NestJS + Prisma + test deps.

- [ ] **Step 9: Run the e2e test → PASS**

Run:
```bash
pnpm --filter @synchub/hub-api test
```
Expected: 1 test PASS (validates via `@synchub/shared`). If module-resolution of the shared package fails, run `pnpm --filter @synchub/shared build` first (dist must exist).

- [ ] **Step 10: Commit**

```bash
git add apps/hub-api pnpm-lock.yaml
git commit -m "feat(hub-api): NestJS skeleton with typed /health via shared contract"
```

---

## Task 5: `apps/hub-api` — Prisma schema (1:1 from schema.sql) + PrismaService

**Files:**
- Create: `apps/hub-api/prisma/schema.prisma`
- Create: `apps/hub-api/src/prisma/{prisma.service.ts,prisma.module.ts}`
- Modify: `apps/hub-api/src/app.module.ts`, `apps/hub-api/src/health/health.controller.ts`

- [ ] **Step 1: Create `apps/hub-api/prisma/schema.prisma`**

Translated from `hub/src/schema.sql` PLUS the `db.js` migrations (`users.name`, `users.notify_conflicts`, `users.notify_sync`). Field names use snake_case via `@map` to preserve the existing DB column names.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id                 Int            @id @default(autoincrement())
  email              String         @unique
  password_hash      String
  password_salt      String
  name               String?
  notify_webhook_url String?
  notify_conflicts   Int            @default(1)
  notify_sync        Int            @default(1)
  created_at         DateTime       @default(now())
  sessions           Session[]
  machines           Machine[]
  projects           Project[]
  notifications      Notification[]
  events             Event[]
  pairingCodes       PairingCode[]
}

model Session {
  token      String   @id
  user_id    Int
  created_at DateTime @default(now())
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
}

model Machine {
  id            Int       @id @default(autoincrement())
  user_id       Int
  name          String
  token         String    @unique
  os            String?
  os_version    String?
  label         String?
  agent_version String?
  last_ip       String?
  status        String    @default("offline")
  last_seen_at  DateTime?
  created_at    DateTime  @default(now())
  user          User      @relation(fields: [user_id], references: [id], onDelete: Cascade)
  mappings      Mapping[]
  pairingCodes  PairingCode[]
}

model PairingCode {
  code       String   @id
  user_id    Int
  machine_id Int?
  expires_at DateTime
  created_at DateTime @default(now())
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  machine    Machine? @relation(fields: [machine_id], references: [id], onDelete: Cascade)
}

model Project {
  id         Int         @id @default(autoincrement())
  user_id    Int
  alias      String
  sync_mode  String      @default("auto")
  created_at DateTime    @default(now())
  user       User        @relation(fields: [user_id], references: [id], onDelete: Cascade)
  mappings   Mapping[]
  fileStates FileState[]
  conflicts  Conflict[]

  @@unique([user_id, alias])
}

model Mapping {
  id         Int      @id @default(autoincrement())
  project_id Int
  machine_id Int
  local_path String
  created_at DateTime @default(now())
  project    Project  @relation(fields: [project_id], references: [id], onDelete: Cascade)
  machine    Machine  @relation(fields: [machine_id], references: [id], onDelete: Cascade)

  @@unique([project_id, machine_id])
}

model FileState {
  id              Int      @id @default(autoincrement())
  project_id      Int
  filename        String
  hash            String
  size            Int      @default(0)
  last_machine_id Int?
  updated_at      DateTime @default(now())
  project         Project  @relation(fields: [project_id], references: [id], onDelete: Cascade)

  @@unique([project_id, filename])
  @@index([project_id])
}

model Conflict {
  id             Int       @id @default(autoincrement())
  project_id     Int
  filename       String
  machine_id     Int?
  candidate_hash String
  auto_merged    Int       @default(0)
  status         String    @default("open")
  created_at     DateTime  @default(now())
  resolved_at    DateTime?
  project        Project   @relation(fields: [project_id], references: [id], onDelete: Cascade)

  @@index([project_id, status])
}

model Notification {
  id         Int      @id @default(autoincrement())
  user_id    Int
  type       String
  title      String
  body       String?
  read       Int      @default(0)
  created_at DateTime @default(now())
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
}

model Event {
  id         Int      @id @default(autoincrement())
  user_id    Int
  machine_id Int?
  project_id Int?
  type       String
  filename   String?
  bytes      Int      @default(0)
  latency_ms Int?
  created_at DateTime @default(now())
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id, created_at])
}
```

- [ ] **Step 2: Create `apps/hub-api/.env` for the datasource**

```
DATABASE_URL="file:./dev.db"
```
(This file is git-ignored via the `apps/hub-api/prisma/*.db` + standard `.env` ignore. If `.env` is not already ignored, add `.env` to root `.gitignore`.)

- [ ] **Step 3: Generate the client and create the first migration**

Run:
```bash
cd apps/hub-api && pnpm prisma migrate dev --name init && cd ../..
```
Expected: creates `apps/hub-api/prisma/migrations/*_init/migration.sql`, applies it to `dev.db`, and generates `@prisma/client`. Verify the migration SQL contains all 10 tables.

- [ ] **Step 4: Create `apps/hub-api/src/prisma/prisma.service.ts`**

```ts
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 5: Create `apps/hub-api/src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Wire PrismaModule into `app.module.ts`**

Replace the contents of `apps/hub-api/src/app.module.ts` with:
```ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 7: Make `/health` actually probe the DB**

Replace the contents of `apps/hub-api/src/health/health.controller.ts` with:
```ts
import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@synchub/shared";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(): Promise<HealthResponse> {
    let db: "up" | "down" = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    return { status: "ok", version: "0.1.0", db };
  }
}
```

- [ ] **Step 8: Update the e2e test to provide a DB and assert `db: "up"`**

Append to `apps/hub-api/test/health.e2e.test.ts` a new assertion inside the existing test (after `parsed.status` check):
```ts
    expect(parsed.db).toBe("up");
```
Ensure `DATABASE_URL` is set when running tests (Step 9 sets it).

- [ ] **Step 9: Run e2e test with the DB → PASS**

Run:
```bash
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @synchub/hub-api test
```
Expected: 1 test PASS with `db: "up"`.

- [ ] **Step 10: Commit**

```bash
git add apps/hub-api pnpm-lock.yaml .gitignore
git commit -m "feat(hub-api): prisma sqlite schema (1:1 from schema.sql) + db health probe"
```

---

## Task 6: `apps/hub-web` — React + Vite SPA skeleton (proves no-refresh nav)

**Files:**
- Create: `apps/hub-web/{package.json,tsconfig.json,vite.config.ts,index.html}`
- Create: `apps/hub-web/src/{main.tsx,router.tsx}`
- Create: `apps/hub-web/src/lib/api.ts`
- Create: `apps/hub-web/src/shell/AppShell.tsx`
- Create: `apps/hub-web/src/routes/Dashboard.tsx`

- [ ] **Step 1: Create `apps/hub-web/package.json`**

```json
{
  "name": "@synchub/hub-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@synchub/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.11",
    "@tanstack/react-router": "^1.95.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/hub-web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/hub-web/vite.config.ts` (proxy API to hub-api during dev)**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/health": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  test: { environment: "jsdom", globals: true },
});
```

- [ ] **Step 4: Create `apps/hub-web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SyncHub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/hub-web/src/lib/api.ts` (typed client using shared)**

```ts
import { HealthResponse } from "@synchub/shared";

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return HealthResponse.parse(await res.json());
}
```

- [ ] **Step 6: Create `apps/hub-web/src/shell/AppShell.tsx` (persistent shell + nav)**

```tsx
import { Link, Outlet } from "@tanstack/react-router";

// The shell mounts ONCE. Navigating between routes swaps only <Outlet/> —
// no full page reload, no WebSocket teardown. This is the structural fix
// for the old multi-page full-refresh behavior.
export function AppShell() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 220, padding: 16, background: "#0f1222", color: "#fff" }}>
        <strong>SyncHub</strong>
        <nav style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <Link to="/">Dashboard</Link>
          <Link to="/projects">Projects</Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Create `apps/hub-web/src/routes/Dashboard.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../lib/api.js";

export function Dashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
  });
  if (isLoading) return <p>Loading…</p>;
  if (isError) return <p>hub-api unreachable</p>;
  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        hub-api: <strong>{data?.status}</strong> · db: <strong>{data?.db}</strong> · v
        {data?.version}
      </p>
    </div>
  );
}

// A trivial second route to demonstrate no-refresh navigation.
export function Projects() {
  return <h1>Projects</h1>;
}
```

- [ ] **Step 8: Create `apps/hub-web/src/router.tsx`**

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./shell/AppShell.js";
import { Dashboard, Projects } from "./routes/Dashboard.js";

const rootRoute = createRootRoute({ component: () => <AppShell /> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Dashboard });
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: Projects,
});

const routeTree = rootRoute.addChildren([indexRoute, projectsRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

Note: `Outlet` is imported by `AppShell`, not here — this import list keeps only what `router.tsx` uses. Remove the unused `Outlet` import if the linter flags it.

- [ ] **Step 9: Create `apps/hub-web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.js";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 10: Write a smoke test `apps/hub-web/src/routes/Dashboard.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", version: "0.1.0", db: "up" }),
    })),
  );
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("Dashboard", () => {
  it("renders health status from the api", async () => {
    render(wrap(<Dashboard />));
    await waitFor(() => expect(screen.getByText("ok")).toBeDefined());
  });
});
```

- [ ] **Step 11: Install deps**

Run:
```bash
pnpm --filter @synchub/hub-web install
```
Expected: installs React, Vite, TanStack, test libs.

- [ ] **Step 12: Run the smoke test → PASS**

Run:
```bash
pnpm --filter @synchub/hub-web test
```
Expected: 1 test PASS.

- [ ] **Step 13: Verify build**

Run:
```bash
pnpm --filter @synchub/shared build && pnpm --filter @synchub/hub-web build
```
Expected: produces `apps/hub-web/dist/` with bundled assets, no TS errors.

- [ ] **Step 14: Manual dev verification (no-refresh nav)**

Run in two terminals:
```bash
pnpm --filter @synchub/hub-api dev      # terminal 1 (needs DATABASE_URL set)
pnpm --filter @synchub/hub-web dev      # terminal 2
```
Open `http://localhost:5173`. Expected: Dashboard shows `hub-api: ok · db: up`. Click "Projects" then "Dashboard" — the page must NOT do a full reload (network tab shows no document request; only the content area changes).

- [ ] **Step 15: Commit**

```bash
git add apps/hub-web pnpm-lock.yaml
git commit -m "feat(hub-web): react+vite SPA skeleton, typed health via shared, no-refresh nav"
```

---

## Task 7: `apps/agent` — TS skeleton CLI

**Files:**
- Create: `apps/agent/{package.json,tsconfig.json}`, `apps/agent/src/cli.ts`

- [ ] **Step 1: Create `apps/agent/package.json`**

```json
{
  "name": "@synchub/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "synchub-agent": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js",
    "test": "vitest run"
  },
  "dependencies": { "@synchub/shared": "workspace:*" },
  "devDependencies": { "tsx": "^4.19.2", "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `apps/agent/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/agent/src/cli.ts`**

```ts
#!/usr/bin/env node

const VERSION = "0.1.0";

function main(argv: string[]): void {
  const cmd = argv[2];
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  console.log("synchub-agent — commands land in Phase 4. Try --version.");
}

main(process.argv);
```

- [ ] **Step 4: Install and verify `--version`**

Run:
```bash
pnpm --filter @synchub/agent install && pnpm --filter @synchub/agent dev -- --version
```
Expected: prints `0.1.0`.

- [ ] **Step 5: Verify build**

Run:
```bash
pnpm --filter @synchub/agent build && node apps/agent/dist/cli.js --version
```
Expected: prints `0.1.0`.

- [ ] **Step 6: Commit**

```bash
git add apps/agent pnpm-lock.yaml
git commit -m "feat(agent): typescript cli skeleton (--version)"
```

---

## Task 8: CI + whole-monorepo verification

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main, rearchitecture-proper-app]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: "file:./dev.db"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable pnpm && corepack prepare pnpm@9.15.0 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @synchub/hub-api prisma:generate
      - run: pnpm --filter @synchub/hub-api exec prisma migrate deploy
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
```

- [ ] **Step 2: Run the full pipeline locally**

Run:
```bash
pnpm install && pnpm lint && pnpm build && DATABASE_URL="file:./apps/hub-api/prisma/dev.db" pnpm test
```
Expected: lint clean, all packages build, all tests pass (shared: 3, hub-api: 1, hub-web: 1). Fix any failure before committing.

- [ ] **Step 3: Verify the legacy app is untouched**

Run:
```bash
git status --porcelain hub/ agent/
```
Expected: NO output (the legacy `hub/` and `agent/` directories were not modified in this phase).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint + build + test the monorepo on push/PR"
```

---

## Self-Review Notes (author checklist — completed)

- **Spec coverage:** §4.1 tooling → Tasks 1–2; §4.2 shared contract → Task 3; §4.3 NestJS + Prisma → Tasks 4–5; §4.4 React SPA → Task 6; §4.5 agent skeleton → Task 7; §5 testing/CI → Tasks 3/4/6 + Task 8; "old app untouched" → Task 8 Step 3. All Phase 1 deliverables mapped.
- **Placeholder scan:** every code step contains full file content; no TBD/TODO.
- **Type consistency:** `HealthResponse` (shared) is produced by hub-api Task 4/5 and consumed by hub-web Task 6 and both tests; `PushResponse`/`WsMessage` defined in Task 3 and only referenced within Task 3's test. `@synchub/shared` package name consistent across all `package.json` deps.
- **Known follow-ups (out of Phase 1 scope):** real auth/projects/machines endpoints (Phase 2), porting sync/merge/relay logic (Phase 2), full UI (Phase 3), agent watcher + binaries (Phase 4).
```
