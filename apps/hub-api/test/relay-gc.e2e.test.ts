import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RelayStoreService } from "../src/sync/relay-store.service.js";
import { RelayGcService } from "../src/sync/relay-gc.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Test-scoped temp dir, mirrors conflict-resolve.e2e.test.ts / sync-push.e2e.test.ts:
// RELAY_STORE_DIR must be set before AppModule is compiled (RelayStoreService
// reads it in its constructor), so the app's relay store and this test's
// blob seeding stay pointed at the same location.
const TEST_DIR = join(tmpdir(), "synchub-relay-gc-e2e-test");
rmSync(TEST_DIR, { recursive: true, force: true });
process.env.RELAY_STORE_DIR = TEST_DIR;

let app: INestApplication;
let prisma: PrismaService;
let relayStore: RelayStoreService;
let relayGc: RelayGcService;

function rand(): string {
  return randomBytes(8).toString("hex");
}

// gcOrphans skips orphan candidates written within its mtime grace window
// (they may be in-flight writes whose DB row hasn't committed yet — see
// relay-store.service.ts). To exercise actual reclamation in these tests,
// backdate a blob's mtime well outside any reasonable grace window, mirroring
// relay-store.service.test.ts's approach for the unit-level GC tests.
function backdateBlob(userId: number, hash: string): void {
  const past = new Date(2020, 0, 1);
  const blobPath = join(TEST_DIR, String(userId), "blobs", hash);
  utimesSync(blobPath, past, past);
}

const createdUserIds: number[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `relay-gc-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createProject(token: string): Promise<{ id: number; alias: string }> {
  const res = await request(app.getHttpServer())
    .post("/api/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ alias: `proj-${rand()}` });
  return { id: res.body.id, alias: res.body.alias };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.set("trust proxy", 1);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  prisma = app.get(PrismaService);
  relayStore = app.get(RelayStoreService);
  relayGc = app.get(RelayGcService);
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("RelayGcService.gcUser", () => {
  it("deletes only blobs unreferenced by file_state.hash", async () => {
    const { token, userId } = await signup();
    const project = await createProject(token);

    // H1: referenced by a file_state row — must survive.
    const h1 = relayStore.writeBlob(userId, `canonical-${rand()}`);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename: "session.jsonl",
        hash: h1,
        size: 1,
      },
    });

    // H2: referenced by nothing — an orphan (e.g. the previous canonical a
    // last-write-wins push superseded). Backdated so it falls outside
    // gcOrphans's mtime grace window and is actually eligible for reclamation
    // in this test (a freshly-written orphan is intentionally skipped — see
    // relay-store.service.test.ts's grace-window tests).
    const h2 = relayStore.writeBlob(userId, `orphan-${rand()}`);
    backdateBlob(userId, h2);

    expect(relayStore.hasBlob(userId, h1)).toBe(true);
    expect(relayStore.hasBlob(userId, h2)).toBe(true);

    const reclaimed = await relayGc.gcUser(userId);

    expect(reclaimed).toBe(1);
    expect(relayStore.hasBlob(userId, h1)).toBe(true);
    expect(relayStore.hasBlob(userId, h2)).toBe(false);
  });
});
