import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", version: "0.1.0", db: "up" }),
    })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("Dashboard", () => {
  it("renders health status from the api", async () => {
    render(wrap(<Dashboard />));
    await waitFor(() => expect(screen.getByText("ok")).toBeDefined());
  });
});
