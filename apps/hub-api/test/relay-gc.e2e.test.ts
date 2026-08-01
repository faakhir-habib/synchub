import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
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

const createdUserIds: number[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `relay-gc-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createMachine(token: string): Promise<{ id: number; machineToken: string }> {
  const res = await request(app.getHttpServer())
    .post("/api/machines")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Machine-${rand()}` });
  return { id: res.body.id, machineToken: res.body.token };
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
  it("deletes only blobs unreferenced by file_state.hash or an OPEN conflict's candidate_hash", async () => {
    const { token, userId } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);

    // H1: referenced by a file_state row.
    const h1 = relayStore.writeBlob(userId, `canonical-${rand()}`);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename: "session.jsonl",
        hash: h1,
        size: 1,
      },
    });

    // H2: referenced by an OPEN conflict's candidate_hash.
    const h2Content = `candidate-${rand()}`;
    const h2 = relayStore.writeBlob(userId, h2Content);
    const conflict = await prisma.conflict.create({
      data: {
        project_id: project.id,
        filename: "other.jsonl",
        machine_id: machine.id,
        candidate_hash: h2,
        auto_merged: 0,
        status: "open",
      },
    });

    // H3: referenced by nothing — an orphan.
    const h3 = relayStore.writeBlob(userId, `orphan-${rand()}`);

    expect(relayStore.hasBlob(userId, h1)).toBe(true);
    expect(relayStore.hasBlob(userId, h2)).toBe(true);
    expect(relayStore.hasBlob(userId, h3)).toBe(true);

    const reclaimed = await relayGc.gcUser(userId);

    expect(reclaimed).toBe(1);
    expect(relayStore.hasBlob(userId, h1)).toBe(true);
    expect(relayStore.hasBlob(userId, h2)).toBe(true);
    expect(relayStore.hasBlob(userId, h3)).toBe(false);

    // Resolving the conflict frees its candidate: h2 becomes reclaimable,
    // h1 (still referenced by file_state) must survive.
    await prisma.conflict.update({
      where: { id: conflict.id },
      data: { status: "resolved", resolved_at: new Date() },
    });

    const reclaimedAfterResolve = await relayGc.gcUser(userId);

    expect(reclaimedAfterResolve).toBe(1);
    expect(relayStore.hasBlob(userId, h1)).toBe(true);
    expect(relayStore.hasBlob(userId, h2)).toBe(false);
  });
});
