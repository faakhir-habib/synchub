import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RelayStoreService } from "../src/sync/relay-store.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Test-scoped temp dir, mirrors sync-read.e2e.test.ts: RELAY_STORE_DIR must be
// set before AppModule is compiled (RelayStoreService reads it in its
// constructor), so the app's relay store and this test's blob seeding stay
// pointed at the same location.
const TEST_DIR = join(tmpdir(), "synchub-sync-push-e2e-test");
rmSync(TEST_DIR, { recursive: true, force: true });
process.env.RELAY_STORE_DIR = TEST_DIR;

let app: INestApplication;
let prisma: PrismaService;
let relayStore: RelayStoreService;

function rand(): string {
  return randomBytes(8).toString("hex");
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const createdUserIds: number[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `sync-push-${rand()}@example.com`;
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

// Full fixture: a user + machine mapped into a fresh project. Isolated per
// test so ordering across cases doesn't matter.
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

function push(
  machineToken: string,
  projectId: number,
  body: { filename: string; content: string; base_hash?: string | null },
) {
  return request(app.getHttpServer())
    .post(`/api/agent/push/${projectId}`)
    .set("X-Machine-Token", machineToken)
    .send(body);
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

describe("POST /api/agent/push/:projectId", () => {
  it("first push: accepts, creates file_state, stores the blob, records a push event", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n{"seq":2,"timestamp":200}\n';

    const res = await push(machine.machineToken, project.id, { filename, content });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(res.body.hash).toBe(sha256(content));

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState).not.toBeNull();
    expect(fileState!.hash).toBe(res.body.hash);
    expect(fileState!.size).toBe(Buffer.byteLength(content, "utf8"));
    expect(fileState!.last_machine_id).toBe(machine.id);

    expect(relayStore.readBlob(userId, res.body.hash)).toBe(content);

    const event = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "push" },
    });
    expect(event).not.toBeNull();
    expect(event!.bytes).toBe(Buffer.byteLength(content, "utf8"));
  });

  it("identical re-push is a no-op: unchanged", async () => {
    const { machine, project } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n{"seq":2,"timestamp":200}\n';

    const first = await push(machine.machineToken, project.id, { filename, content });
    expect(first.status).toBe(200);

    const second = await push(machine.machineToken, project.id, {
      filename,
      content,
      base_hash: first.body.hash,
    });

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: "unchanged", hash: first.body.hash });
  });

  it("clean append (forward): accepted, canonical grows", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const initial = '{"seq":1,"timestamp":100}\n{"seq":2,"timestamp":200}\n';

    const first = await push(machine.machineToken, project.id, { filename, content: initial });
    expect(first.status).toBe(200);

    const appended = initial + '{"seq":3,"timestamp":300}\n';
    const second = await push(machine.machineToken, project.id, {
      filename,
      content: appended,
      base_hash: first.body.hash,
    });

    expect(second.status).toBe(200);
    expect(second.body.status).toBe("accepted");
    expect(second.body.hash).toBe(sha256(appended));
    expect(relayStore.readBlob(userId, second.body.hash)).toBe(appended);

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(second.body.hash);
  });

  it("divergent-but-mergeable append: merged, union ordered by timestamp, auto_merge event, sync notification, NO conflict row", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const lineA3 = '{"seq":3,"timestamp":300,"from":"a"}'; // canonical's own tail line
    const lineB3 = '{"seq":3,"timestamp":250,"from":"b"}'; // incoming's own tail line, EARLIER timestamp

    const canonicalContent = `${line1}\n${line2}\n${lineA3}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    const incomingContent = `${line1}\n${line2}\n${lineB3}\n`;
    // Stale base_hash: what this machine last knew (before "a" appended lineA3).
    const staleBaseHash = sha256(`${line1}\n${line2}\n`);

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: incomingContent,
      base_hash: staleBaseHash,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("merged");

    // Union ordered by timestamp: lineB3 (250) sorts before lineA3 (300).
    const expectedMerged = `${line1}\n${line2}\n${lineB3}\n${lineA3}\n`;
    expect(res.body.hash).toBe(sha256(expectedMerged));
    expect(relayStore.readBlob(userId, res.body.hash)).toBe(expectedMerged);

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(res.body.hash);

    const autoMergeEvent = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "auto_merge" },
    });
    expect(autoMergeEvent).not.toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { user_id: userId, type: "sync" },
    });
    expect(notification).not.toBeNull();

    const conflictCount = await prisma.conflict.count({ where: { project_id: project.id } });
    expect(conflictCount).toBe(0);
  });

  it("true conflict (invalid-JSON tail): 409 {status:'conflict', conflictId}, open conflict row, candidate blob under full hash, conflict notification + event", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const lineA3 = '{"seq":3,"timestamp":300,"from":"a"}';

    const canonicalContent = `${line1}\n${line2}\n${lineA3}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    // Tail line is not valid JSON — not safely mergeable.
    const incomingContent = `${line1}\n${line2}\nnot-valid-json\n`;

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: incomingContent,
      base_hash: null,
    });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe("conflict");
    expect(typeof res.body.conflictId).toBe("number");
    expect(Object.keys(res.body).sort()).toEqual(["conflictId", "status"]);

    const conflict = await prisma.conflict.findUnique({ where: { id: res.body.conflictId } });
    expect(conflict).not.toBeNull();
    expect(conflict!.status).toBe("open");
    expect(conflict!.project_id).toBe(project.id);
    expect(conflict!.filename).toBe(filename);

    // Candidate blob is stored keyed by its FULL hash and holds the full
    // pushed content.
    expect(conflict!.candidate_hash).toBe(sha256(incomingContent));
    expect(relayStore.readBlob(userId, conflict!.candidate_hash)).toBe(incomingContent);

    // Canonical must be untouched.
    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(canonicalHash);

    const conflictEvent = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "conflict" },
    });
    expect(conflictEvent).not.toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { user_id: userId, type: "conflict" },
    });
    expect(notification).not.toBeNull();
  });

  it("one-open-conflict-per-file guard: two concurrent conflict-producing pushes to the SAME file only ever open ONE conflict row, and both responses 409 with a conflictId", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const lineA3 = '{"seq":3,"timestamp":300,"from":"a"}';

    const canonicalContent = `${line1}\n${line2}\n${lineA3}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    // Two different invalid (unmergeable) tails, both diverging from canonical.
    const contentX = `${line1}\n${line2}\nnot-valid-json-x\n`;
    const contentY = `${line1}\n${line2}\nnot-valid-json-y\n`;

    const [resX, resY] = await Promise.all([
      push(machine.machineToken, project.id, { filename, content: contentX, base_hash: null }),
      push(machine.machineToken, project.id, { filename, content: contentY, base_hash: null }),
    ]);

    expect(resX.status).toBe(409);
    expect(resY.status).toBe(409);
    expect(resX.body.status).toBe("conflict");
    expect(resY.body.status).toBe("conflict");
    expect(typeof resX.body.conflictId).toBe("number");
    expect(typeof resY.body.conflictId).toBe("number");
    // Both pushes must resolve to the SAME open conflict row.
    expect(resX.body.conflictId).toBe(resY.body.conflictId);

    const openConflicts = await prisma.conflict.count({
      where: { project_id: project.id, filename, status: "open" },
    });
    expect(openConflicts).toBe(1);
  });

  it("base_hash is advisory-only: a lying base_hash cannot overwrite canonical (data-loss guard)", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const line3 = '{"seq":3,"timestamp":300}';
    const canonicalContent = `${line1}\n${line2}\n${line3}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    // Stale 2-line content, but LIES that base_hash === current canonical
    // hash. A naive "base_hash === current.hash => blind write" would drop
    // line3. base_hash must be advisory-only.
    const staleContent = `${line1}\n${line2}\n`;

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: staleContent,
      base_hash: canonicalHash, // lying
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "behind", hash: canonicalHash });

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(canonicalHash);
    expect(relayStore.readBlob(userId, canonicalHash)).toBe(canonicalContent);
  });

  // This is deterministic regardless of actual scheduling/interleaving: the
  // merge tail is sorted by each line's own `timestamp` field, not by which
  // writer committed first, so the final union order is the same whether
  // the two pushes truly race (one loses its CAS and retries against the
  // other's committed result) or happen to run fully serialized (the second
  // just reads the already-updated canonical on its first attempt). Either
  // way, both lines must survive — that's the property under test.
  it("concurrent divergent pushes to the SAME file do not lose an update (CAS + retry)", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const canonicalContent = `${line1}\n${line2}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    // Two machines each append their OWN different third line on top of the
    // same 2-line canonical, at the same moment.
    const lineX = '{"seq":3,"timestamp":300,"from":"x"}';
    const lineY = '{"seq":3,"timestamp":250,"from":"y"}'; // earlier timestamp
    const contentX = `${line1}\n${line2}\n${lineX}\n`;
    const contentY = `${line1}\n${line2}\n${lineY}\n`;

    // Fire both pushes concurrently — without CAS+retry, whichever write
    // commits last would silently overwrite canonical with only its own
    // tail, dropping the other machine's line despite both requests
    // reporting a 200.
    const [resX, resY] = await Promise.all([
      push(machine.machineToken, project.id, { filename, content: contentX, base_hash: canonicalHash }),
      push(machine.machineToken, project.id, { filename, content: contentY, base_hash: canonicalHash }),
    ]);

    expect(resX.status).toBe(200);
    expect(resY.status).toBe(200);
    expect(["accepted", "merged"]).toContain(resX.body.status);
    expect(["accepted", "merged"]).toContain(resY.body.status);

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState).not.toBeNull();

    const finalContent = relayStore.readBlob(userId, fileState!.hash);
    expect(finalContent).not.toBeNull();

    // No lost update: BOTH machines' lines survive, unioned and ordered by
    // timestamp (lineY's 250 sorts before lineX's 300) regardless of commit order.
    expect(finalContent).toBe(`${line1}\n${line2}\n${lineY}\n${lineX}\n`);

    // The race must resolve via merge, never a spurious conflict row.
    const conflictCount = await prisma.conflict.count({ where: { project_id: project.id, filename } });
    expect(conflictCount).toBe(0);
  });

  it("returns 404 for a project the machine is not mapped to", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    // No mapping created.

    const res = await push(machine.machineToken, project.id, {
      filename: "session.jsonl",
      content: '{"seq":1,"timestamp":100}\n',
    });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not mapped to project");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/agent/push/1")
      .send({ filename: "session.jsonl", content: "{}\n" });

    expect(res.status).toBe(401);
  });
});
