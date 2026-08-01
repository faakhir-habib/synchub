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
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Test-scoped temp dir, mirrors sync-push.e2e.test.ts: RELAY_STORE_DIR must be
// set before AppModule is compiled (RelayStoreService reads it in its
// constructor), so the app's relay store and this test's blob seeding stay
// pointed at the same location.
const TEST_DIR = join(tmpdir(), "synchub-conflict-resolve-e2e-test");
rmSync(TEST_DIR, { recursive: true, force: true });
process.env.RELAY_STORE_DIR = TEST_DIR;

let app: INestApplication;
let prisma: PrismaService;
let relayStore: RelayStoreService;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `conflict-resolve-${rand()}@example.com`;
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

async function mapMachine(
  token: string,
  projectId: number,
  machineId: number,
  localPath: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .put(`/api/projects/${projectId}/mappings/${machineId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ local_path: localPath });
  expect(res.status).toBe(200);
}

// Seeds a canonical file_state + blob, a candidate blob, and an OPEN conflict
// row referencing the candidate by its full content-addressed hash. Mirrors
// the shape the push decision tree (SyncService) leaves behind on a true
// conflict, without going through a real push.
async function seedConflict(
  userId: number,
  projectId: number,
  machineId: number,
  filename: string,
  canonicalContent: string,
  candidateContent: string,
): Promise<{ conflictId: number; canonicalHash: string; candidateHash: string }> {
  const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
  await prisma.fileState.create({
    data: {
      project_id: projectId,
      filename,
      hash: canonicalHash,
      size: Buffer.byteLength(canonicalContent, "utf8"),
    },
  });

  const candidateHash = relayStore.writeBlob(userId, candidateContent);
  const conflict = await prisma.conflict.create({
    data: {
      project_id: projectId,
      filename,
      machine_id: machineId,
      candidate_hash: candidateHash,
      auto_merged: 0,
      status: "open",
    },
  });

  return { conflictId: conflict.id, canonicalHash, candidateHash };
}

// Full fixture: a user + machine mapped into a fresh project.
async function setup(): Promise<{
  token: string;
  userId: number;
  machine: { id: number; machineToken: string };
  project: { id: number; alias: string };
}> {
  const { token, userId } = await signup();
  const machine = await createMachine(token);
  const project = await createProject(token);
  await mapMachine(token, project.id, machine.id, "/home/user/project");
  return { token, userId, machine, project };
}

function resolve(
  token: string,
  projectId: number,
  conflictId: number,
  body?: { choice?: string },
) {
  const req = request(app.getHttpServer())
    .post(`/api/projects/${projectId}/conflicts/${conflictId}/resolve`)
    .set("Authorization", `Bearer ${token}`);
  return body === undefined ? req.send() : req.send(body);
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
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("POST /api/projects/:id/conflicts/:conflictId/resolve", () => {
  it("choice=candidate: promotes candidate to canonical, marks resolved, records event, notifies, fans out realtime", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const canonicalContent = '{"seq":1}\n{"seq":2}\n';
    const candidateContent = '{"seq":1}\n{"seq":2}\nnot-valid-json\n';

    const { conflictId, candidateHash } = await seedConflict(
      userId,
      project.id,
      machine.id,
      filename,
      canonicalContent,
      candidateContent,
    );

    const res = await resolve(token, project.id, conflictId, { choice: "candidate" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "resolved", choice: "candidate" });

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(candidateHash);
    expect(fileState!.last_machine_id).toBe(machine.id);
    expect(relayStore.readBlob(userId, fileState!.hash)).toBe(candidateContent);

    const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
    expect(conflict!.status).toBe("resolved");
    expect(conflict!.resolved_at).not.toBeNull();

    const event = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "conflict_resolved" },
    });
    expect(event).not.toBeNull();
    expect(event!.bytes).toBe(Buffer.byteLength(candidateContent, "utf8"));

    const notification = await prisma.notification.findFirst({
      where: { user_id: userId, type: "sync" },
    });
    expect(notification).not.toBeNull();
    expect(notification!.title).toBe(`Conflict resolved: ${filename}`);
  });

  it("choice=canonical: leaves canonical file_state UNCHANGED, marks resolved, records event", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const canonicalContent = '{"seq":1}\n{"seq":2}\n';
    const candidateContent = '{"seq":1}\n{"seq":2}\nnot-valid-json\n';

    const { conflictId, canonicalHash } = await seedConflict(
      userId,
      project.id,
      machine.id,
      filename,
      canonicalContent,
      candidateContent,
    );

    const res = await resolve(token, project.id, conflictId, { choice: "canonical" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "resolved", choice: "canonical" });

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(canonicalHash);
    expect(relayStore.readBlob(userId, fileState!.hash)).toBe(canonicalContent);

    const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
    expect(conflict!.status).toBe("resolved");
    expect(conflict!.resolved_at).not.toBeNull();

    const event = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "conflict_resolved" },
    });
    expect(event).not.toBeNull();
  });

  it("default choice (omitted body) is treated as candidate", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const canonicalContent = '{"seq":1}\n{"seq":2}\n';
    const candidateContent = '{"seq":1}\n{"seq":2}\nnot-valid-json\n';

    const { conflictId, candidateHash } = await seedConflict(
      userId,
      project.id,
      machine.id,
      filename,
      canonicalContent,
      candidateContent,
    );

    const res = await resolve(token, project.id, conflictId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "resolved", choice: "candidate" });

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(candidateHash);
  });

  it("returns 404 resolving a conflict in another user's project", async () => {
    const owner = await setup();
    const filename = "session.jsonl";
    const { conflictId } = await seedConflict(
      owner.userId,
      owner.project.id,
      owner.machine.id,
      filename,
      '{"seq":1}\n',
      '{"seq":1}\nbad\n',
    );

    const stranger = await signup();
    const res = await resolve(stranger.token, owner.project.id, conflictId, { choice: "candidate" });

    expect(res.status).toBe(404);
  });

  it("returns 404 resolving an already-resolved conflict", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const { conflictId } = await seedConflict(
      userId,
      project.id,
      machine.id,
      filename,
      '{"seq":1}\n',
      '{"seq":1}\nbad\n',
    );

    const first = await resolve(token, project.id, conflictId, { choice: "canonical" });
    expect(first.status).toBe(200);

    const second = await resolve(token, project.id, conflictId, { choice: "canonical" });
    expect(second.status).toBe(404);
  });

  it("returns 404 when the conflictId does not belong to the given project", async () => {
    const { token, userId, machine, project: projectA } = await setup();
    const projectB = await createProject(token);
    const filename = "session.jsonl";

    const { conflictId } = await seedConflict(
      userId,
      projectA.id,
      machine.id,
      filename,
      '{"seq":1}\n',
      '{"seq":1}\nbad\n',
    );

    // conflictId belongs to projectA, not projectB.
    const res = await resolve(token, projectB.id, conflictId, { choice: "candidate" });
    expect(res.status).toBe(404);
  });

  it("returns 410 when the candidate blob is missing and choice=candidate", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const { conflictId, candidateHash } = await seedConflict(
      userId,
      project.id,
      machine.id,
      filename,
      '{"seq":1}\n',
      '{"seq":1}\nbad\n',
    );

    relayStore.removeBlob(userId, candidateHash);

    const res = await resolve(token, project.id, conflictId, { choice: "candidate" });
    expect(res.status).toBe(410);
    expect(res.body).toHaveProperty("error", "candidate content missing");
    expect(res.body).toHaveProperty("code", "candidate_missing");

    // The conflict must remain open — the resolve did not commit.
    const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
    expect(conflict!.status).toBe("open");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/projects/1/conflicts/1/resolve")
      .send({ choice: "candidate" });

    expect(res.status).toBe(401);
  });
});
