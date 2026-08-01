import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotifyService } from "./notify.service.js";
import type { RealtimePort } from "../realtime/realtime.port.js";

function rand(): string {
  return randomBytes(8).toString("hex");
}

// A public, non-reserved IPv4 literal (example.com's real IP). Used as a
// literal in webhook URLs below so assertPublicHttpUrl's "is this address
// public" check runs for real, with NO DNS lookup involved (literal IPs skip
// resolution entirely) — hermetic without mocking node:dns.
const PUBLIC_IP = "93.184.216.34";

let prisma: PrismaService;
let realtime: RealtimePort & { pushNotification: ReturnType<typeof vi.fn> };
let notify: NotifyService;
const createdUserIds: number[] = [];

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.$connect();
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  realtime = {
    notifyProjectChanged: vi.fn(),
    syncProgress: vi.fn(),
    syncComplete: vi.fn(),
    broadcastPresence: vi.fn(),
    pushNotification: vi.fn(),
  };
  notify = new NotifyService(prisma, realtime);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createUser(
  prefs: { notify_conflicts?: number; notify_sync?: number; notify_webhook_url?: string } = {},
) {
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

// vi.waitFor polls until the assertion inside stops throwing (or times out).
// Needed because NotifyService's webhook relay is fire-and-forget (`void
// this.relayWebhook(...)`) — it is NOT awaited before notify() returns, so
// assertions about whether fetch was/wasn't called must tolerate a tick or
// two of async scheduling (the SSRF check + fetch happen on later microtasks).
async function expectEventually(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 1000, interval: 10 });
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

  it("pushes live over WS via RealtimePort.pushNotification when the row is inserted", async () => {
    const user = await createUser();

    await notify.notify({ user_id: user.id, type: "info", title: "Heads up", body: "b" });

    expect(realtime.pushNotification).toHaveBeenCalledWith(user.id, {
      type: "info",
      title: "Heads up",
      body: "b",
    });
  });

  it("does NOT push over WS or insert a row when the notify is gated out", async () => {
    const user = await createUser({ notify_conflicts: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    const note = await notify.notify({ user_id: user.id, type: "conflict", title: "Conflict!" });

    expect(note).toBeNull();
    expect(realtime.pushNotification).not.toHaveBeenCalled();
    const rows = await prisma.notification.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(0);
    // Give any (incorrect) fire-and-forget work a chance to run, then confirm
    // the webhook path never even started for a gated-out notify.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT fetch a private/loopback webhook URL — SSRF blocked", async () => {
    const user = await createUser({ notify_webhook_url: "http://127.0.0.1/hook" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    const note = await notify.notify({ user_id: user.id, type: "info", title: "Heads up" });

    expect(note).not.toBeNull();
    expect(realtime.pushNotification).toHaveBeenCalled();
    // Wait past any async scheduling to prove fetch is never invoked, not
    // merely "hasn't been invoked yet."
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT fetch a metadata-service webhook URL — SSRF blocked", async () => {
    const user = await createUser({ notify_webhook_url: "http://169.254.169.254/hook" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    await notify.notify({ user_id: user.id, type: "info", title: "Heads up" });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches a public webhook URL with the expected JSON body", async () => {
    const user = await createUser({ notify_webhook_url: `http://${PUBLIC_IP}/hook` });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    await notify.notify({ user_id: user.id, type: "sync", title: "Synced", body: "all done" });

    await expectEventually(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`http://${PUBLIC_IP}/hook`);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
    });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ type: "sync", title: "Synced", body: "all done" });
    expect(body.at).toEqual(expect.any(String));
  });

  it("does not throw and still returns the row when the webhook fetch itself rejects", async () => {
    const user = await createUser({ notify_webhook_url: `http://${PUBLIC_IP}/hook` });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const note = await notify.notify({ user_id: user.id, type: "info", title: "Heads up" });

    expect(note).not.toBeNull();
  });
});
