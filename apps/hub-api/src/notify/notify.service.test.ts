import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotifyService } from "./notify.service.js";

function rand(): string {
  return randomBytes(8).toString("hex");
}

let prisma: PrismaService;
let notify: NotifyService;
const createdUserIds: number[] = [];

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  notify = new NotifyService(prisma);
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function createUser(prefs: { notify_conflicts?: number; notify_sync?: number } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `notify-${rand()}@example.com`,
      password_hash: "x",
      password_salt: "x",
      ...prefs,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

// Ports the gate logic in hub/src/lib/notify.js:9-10 exactly: only
// type === "conflict" / "sync" are gated by the matching user preference;
// every other type always proceeds.
describe("NotifyService#notify", () => {
  it("inserts a row for type=conflict when the user's notify_conflicts=1", async () => {
    const user = await createUser({ notify_conflicts: 1 });

    const note = await notify.notify({ user_id: user.id, type: "conflict", title: "Conflict!" });

    expect(note).not.toBeNull();
    expect(note!.type).toBe("conflict");
    const rows = await prisma.notification.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("returns null and inserts nothing for type=conflict when notify_conflicts=0", async () => {
    const user = await createUser({ notify_conflicts: 0 });

    const note = await notify.notify({ user_id: user.id, type: "conflict", title: "Conflict!" });

    expect(note).toBeNull();
    const rows = await prisma.notification.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("inserts a row for type=sync when the user's notify_sync=1", async () => {
    const user = await createUser({ notify_sync: 1 });

    const note = await notify.notify({ user_id: user.id, type: "sync", title: "Synced" });

    expect(note).not.toBeNull();
    expect(note!.type).toBe("sync");
    const rows = await prisma.notification.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("returns null and inserts nothing for type=sync when notify_sync=0", async () => {
    const user = await createUser({ notify_sync: 0 });

    const note = await notify.notify({ user_id: user.id, type: "sync", title: "Synced" });

    expect(note).toBeNull();
    const rows = await prisma.notification.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("always inserts for a type other than conflict/sync, regardless of prefs", async () => {
    const user = await createUser({ notify_conflicts: 0, notify_sync: 0 });

    const note = await notify.notify({ user_id: user.id, type: "info", title: "Heads up" });

    expect(note).not.toBeNull();
    expect(note!.type).toBe("info");
    const rows = await prisma.notification.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("returns null when the user doesn't exist (no row, no throw)", async () => {
    const note = await notify.notify({ user_id: 999999999, type: "info", title: "Nope" });
    expect(note).toBeNull();
  });
});
