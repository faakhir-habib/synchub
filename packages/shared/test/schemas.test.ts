import { describe, it, expect } from "vitest";
import { HealthResponse, PushResponse, SignupRequest, WsMessage } from "../src/index.js";

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

  it("rejects an invalid SignupRequest email", () => {
    const r = SignupRequest.safeParse({ email: "not-an-email", password: "12345678" });
    expect(r.success).toBe(false);
  });

  it("discriminates a WsSyncComplete message", () => {
    const msg = WsMessage.parse({
      type: "sync-complete",
      projectId: 1,
      at: "2026-08-01T00:00:00Z",
    });
    expect(msg.type).toBe("sync-complete");
  });
});
