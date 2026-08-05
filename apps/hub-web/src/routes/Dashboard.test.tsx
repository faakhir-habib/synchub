import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardMetrics } from "@synchub/shared";
import { ApiError } from "../lib/api-error.js";
import type { ActivityEvent } from "../lib/endpoints.js";

const { getMetricsMock, getActivityMock } = vi.hoisted(() => ({
  getMetricsMock: vi.fn(),
  getActivityMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  getMetrics: getMetricsMock,
  getActivity: getActivityMock,
}));

// Imported after the mock above so it picks up the mocked module.
import { Dashboard } from "./Dashboard.js";

const METRICS: DashboardMetrics = {
  projects: { total: 7, syncing: 2 },
  machines: { total: 4, online: 3 },
  eventsToday: 42,
  dataTransferredBytes: 5_242_880,
  sessionsSyncedToday: 15,
  syncSuccessRate: 97,
  avgLatencyMs: 128,
  unreadNotifications: 3,
};

const ACTIVITY: ActivityEvent[] = [
  {
    id: 1,
    user_id: 1,
    machine_id: 2,
    project_id: 3,
    type: "push",
    filename: "src/index.ts",
    bytes: 2048,
    latency_ms: 40,
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    user_id: 1,
    machine_id: 2,
    project_id: 3,
    type: "sync_now",
    filename: "src/app.ts",
    bytes: 0,
    latency_ms: null,
    created_at: new Date().toISOString(),
  },
];

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  getMetricsMock.mockReset();
  getActivityMock.mockReset();
});

describe("Dashboard", () => {
  it("renders skeleton placeholders while metrics and activity are loading — never a bare dash", async () => {
    // Never-resolving promises keep both queries in the `isPending` state
    // for the lifetime of the assertion.
    getMetricsMock.mockReturnValue(new Promise(() => {}));
    getActivityMock.mockReturnValue(new Promise(() => {}));

    render(wrap(<Dashboard />));

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
    expect(screen.queryByText("—")).toBeNull();
  });

  it("renders real metric tiles and the activity list once the queries resolve", async () => {
    getMetricsMock.mockResolvedValue(METRICS);
    getActivityMock.mockResolvedValue(ACTIVITY);

    render(wrap(<Dashboard />));

    await waitFor(() => expect(screen.getByText("7")).toBeDefined()); // active projects
    expect(screen.getByText("2 syncing now")).toBeDefined();
    expect(screen.getByText("4")).toBeDefined(); // connected machines
    expect(screen.getByText("3 online")).toBeDefined();
    expect(screen.getByText("97%")).toBeDefined(); // sync success rate
    expect(screen.getByText("Needs your attention")).toBeDefined(); // unread notifications hint

    // secondary "sync engine" metrics
    expect(screen.getByText("42")).toBeDefined(); // events today
    expect(screen.getByText("15")).toBeDefined(); // files synced today
    expect(screen.getByText("128ms")).toBeDefined(); // avg latency

    // activity feed rows
    expect(screen.getByText("src/index.ts")).toBeDefined();
    expect(screen.getByText("src/app.ts")).toBeDefined();
    expect(screen.getByText("File pushed")).toBeDefined();
    expect(screen.getByText("Manual sync")).toBeDefined();

    expect(screen.queryAllByTestId("skeleton").length).toBe(0);
  });

  it("renders an error panel when the metrics request rejects with an ApiError", async () => {
    getMetricsMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));
    getActivityMock.mockResolvedValue([]);

    render(wrap(<Dashboard />));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/));
  });
});
