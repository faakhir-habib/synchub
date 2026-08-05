import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { setAuthToken, get } from "./api.js";
import { ApiError } from "./api-error.js";
import { getMetrics, login } from "./endpoints.js";

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  setAuthToken(null);
});

describe("api client", () => {
  it("includes an Authorization header once a token is set", async () => {
    setAuthToken("tok");
    const spy = mockFetch(async () => jsonResponse(200, { ok: true }));

    await get("/api/auth/me");

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
  });

  it("parses a 2xx JSON response through a zod schema", async () => {
    mockFetch(async () => jsonResponse(200, { foo: "bar" }));
    const schema = z.object({ foo: z.string() });

    const result = await get("/api/whatever", schema);

    expect(result).toEqual({ foo: "bar" });
  });

  it("throws an ApiError on a non-2xx response", async () => {
    mockFetch(async () => jsonResponse(400, { error: "bad input", code: "invalid_request" }));

    await expect(get("/api/whatever")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "invalid_request",
      message: "bad input",
    });
    await expect(get("/api/whatever")).rejects.toBeInstanceOf(ApiError);
  });

  it("getMetrics fetches /api/dashboard/metrics and returns DashboardMetrics", async () => {
    const metrics = {
      projects: { total: 3, syncing: 1 },
      machines: { total: 2, online: 1 },
      eventsToday: 5,
      dataTransferredBytes: 1024,
      sessionsSyncedToday: 4,
      syncSuccessRate: 0.99,
      avgLatencyMs: 42,
      unreadNotifications: 2,
    };
    const spy = mockFetch(async () => jsonResponse(200, metrics));

    const result = await getMetrics();

    expect(spy).toHaveBeenCalledWith("/api/dashboard/metrics", expect.anything());
    expect(result).toEqual(metrics);
  });

  it("login posts to /api/auth/login with a JSON body and returns LoginResponse", async () => {
    const response = { token: "abc123", user: { id: 1, email: "a@b.com" } };
    const spy = mockFetch(async () => jsonResponse(200, response));

    const result = await login({ email: "a@b.com", password: "password123" });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com", password: "password123" });
    expect(result).toEqual(response);
  });
});
