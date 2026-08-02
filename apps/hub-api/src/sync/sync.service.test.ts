import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { RelayStoreService } from "./relay-store.service.js";
import { MergeService } from "./merge.service.js";
import { NotifyService } from "../notify/notify.service.js";
import { SyncService } from "./sync.service.js";
import type { RealtimePort } from "../realtime/realtime.port.js";

// Test-scoped temp dir, mirrors relay-store.service.test.ts: RelayStoreService
// reads RELAY_STORE_DIR from the environment in its constructor.
const TEST_DIR = join(tmpdir(), "synchub-sync-service-test");
rmSync(TEST_DIR, { recursive: true, force: true });
process.env.RELAY_STORE_DIR = TEST_DIR;

function rand(): string {
  return randomBytes(8).toString("hex");
}

let prisma: PrismaService;
let relayStore: RelayStoreService;
let realtime: RealtimePort & { notifyDeleted: ReturnType<typeof vi.fn> };
let sync: SyncService;
const createdUserIds: number[] = [];

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  relayStore = new RelayStoreService();
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  realtime = {
    notifyProjectChanged: vi.fn(),
    notifyDeleted: vi.fn(),
    syncProgress: vi.fn(),
    syncComplete: vi.fn(),
    broadcastPresence: vi.fn(),
    pushNotification: vi.fn(),
    triggerSync: vi.fn(),
  };
  const notify = new NotifyService(prisma, realtime);
  sync = new SyncService(prisma, relayStore, new MergeService(), notify, realtime);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Full fixture: a user + a machine mapped into a fresh project, exactly what
// deleteFile's requireMapping check needs.
async function setup(): Promise<{
  userId: number;
  machine: Machine;
  projectId: number;
}> {
  const user = await prisma.user.create({
    data: { email: `sync-svc-${rand()}@example.com`, password_hash: "x", password_salt: "x" },
  });
  createdUserIds.push(user.id);

  const machine = await prisma.machine.create({
    data: { user_id: user.id, name: `Machine-${rand()}`, token: rand() },
  });

  const project = await prisma.project.create({
    data: { user_id: user.id, alias: `proj-${rand()}` },
  });

  await prisma.mapping.create({
    data: { project_id: project.id, machine_id: machine.id, local_path: "/home/user/project" },
  });

  return { userId: user.id, machine, projectId: project.id };
}

describe("SyncService#deleteFile", () => {
  it("deletes the file_state row and fans out via notifyDeleted", async () => {
    const { userId, machine, projectId } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n';
    const hash = relayStore.writeBlob(userId, content);
    await prisma.fileState.create({
      data: { project_id: projectId, filename, hash, size: Buffer.byteLength(content, "utf8") },
    });

    const result = await sync.deleteFile(machine, projectId, filename);

    expect(result).toEqual({ status: "deleted" });
    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename } },
    });
    expect(fileState).toBeNull();
    expect(realtime.notifyDeleted).toHaveBeenCalledWith(userId, projectId, filename, machine.id);
  });

  // FIX 1 regression test: the delete transaction has already committed by
  // the time the post-commit fan-out (project lookup + notifyDeleted) runs.
  // If that fan-out throws — e.g. a transient DB hiccup on the lookup, or
  // the realtime gateway itself throwing — deleteFile must still resolve
  // successfully. Without the try/catch around the fan-out, this throw would
  // propagate out of deleteFile and the controller would turn an
  // already-successful delete into a 500 for the agent.
  it("still returns {status:'deleted'} and keeps the row deleted when the fan-out (notifyDeleted) throws", async () => {
    const { userId, machine, projectId } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n';
    const hash = relayStore.writeBlob(userId, content);
    await prisma.fileState.create({
      data: { project_id: projectId, filename, hash, size: Buffer.byteLength(content, "utf8") },
    });

    realtime.notifyDeleted.mockImplementation(() => {
      throw new Error("transient realtime failure");
    });

    const result = await sync.deleteFile(machine, projectId, filename);

    expect(result).toEqual({ status: "deleted" });
    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename } },
    });
    expect(fileState).toBeNull();

    const event = await prisma.event.findFirst({
      where: { project_id: projectId, filename, type: "delete" },
    });
    expect(event).not.toBeNull();
  });
});
