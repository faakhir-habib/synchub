import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { get, setAuthToken } from "../lib/api.js";
import { ApiError } from "../lib/api-error.js";
import { setUnauthorizedHandler, notifyUnauthorized } from "../lib/unauthorized.js";
import { AuthProvider, useAuth, AUTH_TOKEN_STORAGE_KEY } from "./auth-context.js";

// Deliberately does NOT mock ../lib/api.js, ../lib/endpoints.js, or
// ../lib/unauthorized.js — this test exercises the real 401 wiring:
// api.ts's request() firing the global unauthorized handler, and
// AuthProvider registering/clearing the session in response.

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

const ME = {
  id: 1,
  email: "a@b.com",
  name: null,
  notify_webhook_url: null,
  notify_sync: true,
};

function AuthProbe() {
  const { token } = useAuth();
  return <span data-testid="probe-token">{token ?? "none"}</span>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  setAuthToken(null);
  setUnauthorizedHandler(null);
});

describe("unauthorized registry", () => {
  it("invokes the currently registered handler and is a no-op when none is registered", () => {
    // No handler registered — must not throw.
    expect(() => notifyUnauthorized()).not.toThrow();

    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    notifyUnauthorized();
    expect(handler).toHaveBeenCalledTimes(1);

    setUnauthorizedHandler(null);
    notifyUnauthorized();
    // Still only called once — the cleared handler must not fire again.
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("app-wide 401 handling", () => {
  it("a 401 from any request clears the session (token, api client, localStorage) without calling logout", async () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "expiring-token");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return jsonResponse(200, ME);
      }
      // Every other request (standing in for some later query/mutation
      // whose session has since expired/been revoked) 401s.
      return jsonResponse(401, { error: "Session expired", code: "unauthorized" });
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    // Rehydration succeeds first — we start out logged in.
    await waitFor(() => expect(screen.getByTestId("probe-token").textContent).toBe("expiring-token"));

    // A later, unrelated request (not the initial rehydration) 401s.
    await expect(get("/api/dashboard/metrics")).rejects.toBeInstanceOf(ApiError);

    // The global handler AuthProvider registered clears the session — token
    // state (not just the module-level authToken) updates so AuthGuard would
    // re-render and redirect.
    await waitFor(() => expect(screen.getByTestId("probe-token").textContent).toBe("none"));
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();

    // Never hit the logout endpoint — the session was already invalid, so
    // that call would just 401 again.
    const calledUrls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(calledUrls.some((u) => u.includes("/auth/logout"))).toBe(false);
  });
});
