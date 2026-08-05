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

  it("divergent push (last-write-wins): incoming overwrites canonical wholesale, plain push event, NO merge", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const lineA3 = '{"seq":3,"timestamp":300,"from":"a"}'; // canonical's own tail line
    const lineB3 = '{"seq":3,"timestamp":250,"from":"b"}'; // incoming's own tail line

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
    // base_hash is ignored under last-write-wins; pass a stale one to prove it.
    const staleBaseHash = sha256(`${line1}\n${line2}\n`);

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: incomingContent,
      base_hash: staleBaseHash,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");

    // Last-write-wins: canonical becomes EXACTLY the incoming content — no
    // union, no timestamp reordering, lineA3 is dropped.
    expect(res.body.hash).toBe(sha256(incomingContent));
    expect(relayStore.readBlob(userId, res.body.hash)).toBe(incomingContent);

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(res.body.hash);

    // Recorded as a plain push — the "auto_merge" event type no longer exists.
    const pushEvent = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "push" },
    });
    expect(pushEvent).not.toBeNull();
    const autoMergeEvent = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "auto_merge" },
    });
    expect(autoMergeEvent).toBeNull();
  });

  it("non-JSON / edited content (last-write-wins): overwrites canonical, no conflict", async () => {
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

    // Tail line is not valid JSON — under the old merge engine this was a
    // "conflict"; under last-write-wins it simply overwrites.
    const incomingContent = `${line1}\n${line2}\nnot-valid-json\n`;

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: incomingContent,
      base_hash: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(res.body.hash).toBe(sha256(incomingContent));
    expect(relayStore.readBlob(userId, res.body.hash)).toBe(incomingContent);

    // Canonical is now the incoming content.
    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(sha256(incomingContent));

    const pushEvent = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "push" },
    });
    expect(pushEvent).not.toBeNull();
  });

  it("two concurrent unmergeable pushes to the SAME file: both accepted, canonical is one of them (last-write-wins)", async () => {
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

    const contentX = `${line1}\n${line2}\nnot-valid-json-x\n`;
    const contentY = `${line1}\n${line2}\nnot-valid-json-y\n`;

    const [resX, resY] = await Promise.all([
      push(machine.machineToken, project.id, { filename, content: contentX, base_hash: null }),
      push(machine.machineToken, project.id, { filename, content: contentY, base_hash: null }),
    ]);

    expect(resX.status).toBe(200);
    expect(resY.status).toBe(200);
    expect(resX.body.status).toBe("accepted");
    expect(resY.body.status).toBe("accepted");

    // Exactly one of the two pushes wins the canonical slot (whichever
    // committed last) — no conflict, no union.
    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    const finalContent = relayStore.readBlob(userId, fileState!.hash);
    expect([contentX, contentY]).toContain(finalContent);
  });

  it("an older/shorter push still overwrites canonical (last-write-wins, base_hash ignored)", async () => {
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

    // A stale 2-line copy. Under last-write-wins the latest push always wins,
    // so this overwrites the 3-line canonical (line3 is intentionally lost —
    // that is the accepted semantics of last-write-wins). base_hash plays no
    // part in the decision.
    const staleContent = `${line1}\n${line2}\n`;

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: staleContent,
      base_hash: canonicalHash,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(res.body.hash).toBe(sha256(staleContent));

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState!.hash).toBe(sha256(staleContent));
    expect(relayStore.readBlob(userId, sha256(staleContent))).toBe(staleContent);
  });

  // Two machines push different content to the same file at the same moment.
  // The canonical write is CAS-guarded, so a loser retries against the fresh
  // canonical and overwrites it — the final canonical is exactly ONE machine's
  // content (last-write-wins), never a corrupted mix and never a conflict.
  it("concurrent divergent pushes to the SAME file: last-write-wins, canonical is one machine's content", async () => {
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

    const lineX = '{"seq":3,"timestamp":300,"from":"x"}';
    const lineY = '{"seq":3,"timestamp":250,"from":"y"}';
    const contentX = `${line1}\n${line2}\n${lineX}\n`;
    const contentY = `${line1}\n${line2}\n${lineY}\n`;

    const [resX, resY] = await Promise.all([
      push(machine.machineToken, project.id, { filename, content: contentX, base_hash: canonicalHash }),
      push(machine.machineToken, project.id, { filename, content: contentY, base_hash: canonicalHash }),
    ]);

    expect(resX.status).toBe(200);
    expect(resY.status).toBe(200);
    expect(resX.body.status).toBe("accepted");
    expect(resY.body.status).toBe("accepted");

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState).not.toBeNull();

    const finalContent = relayStore.readBlob(userId, fileState!.hash);
    // Last-write-wins: canonical is exactly one machine's content, intact.
    expect([contentX, contentY]).toContain(finalContent);
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
