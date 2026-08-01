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

  it("discriminates a WsPresence message (realtime contract)", () => {
    const msg = WsMessage.parse({
      type: "presence",
      machineId: 7,
      status: "online",
      lastSeenAt: null,
    });
    expect(msg.type).toBe("presence");
  });

  it("discriminates a WsSyncProgress message (realtime contract)", () => {
    const msg = WsMessage.parse({
      type: "sync-progress",
      projectId: 1,
      machineId: 7,
      completed: 2,
      total: 5,
      phase: "push",
    });
    expect(msg.type).toBe("sync-progress");
  });
});
