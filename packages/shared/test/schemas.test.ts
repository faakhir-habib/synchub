import { describe, it, expect } from "vitest";
import {
  DashboardMetrics,
  DeleteRequest,
  HealthResponse,
  ProjectCreateRequest,
  PushResponse,
  SignupRequest,
  WsMessage,
} from "../src/index.js";

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

  it("discriminates a WsDeleted message", () => {
    const msg = WsMessage.parse({
      type: "deleted",
      projectId: 1,
      filename: "a.jsonl",
    });
    expect(msg.type).toBe("deleted");
  });

  it("accepts a valid DeleteRequest", () => {
    const ok = DeleteRequest.parse({ filename: "a.jsonl" });
    expect(ok.filename).toBe("a.jsonl");
  });

  it("discriminates a WsSyncComplete message", () => {
    const msg = WsMessage.parse({
      type: "sync-complete",
      projectId: 1,
      at: "2026-08-01T00:00:00Z",
    });
    expect(msg.type).toBe("sync-complete");
  });

  it("accepts a valid DashboardMetrics", () => {
    const ok = DashboardMetrics.parse({
      projects: { total: 3, syncing: 1 },
      machines: { total: 5, online: 2 },
      eventsToday: 12,
      dataTransferredBytes: 4096,
      sessionsSyncedToday: 7,
      syncSuccessRate: 0.98,
      avgLatencyMs: 42,
      unreadNotifications: 1,
    });
    expect(ok.projects.total).toBe(3);
  });

  it("rejects a ProjectCreateRequest missing alias", () => {
    const r = ProjectCreateRequest.safeParse({});
    expect(r.success).toBe(false);
  });
});
