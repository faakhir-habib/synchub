import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Conflict, PublicMachine } from "@synchub/shared";
import { ApiError } from "../lib/api-error.js";
import { timeAgo } from "../lib/format.js";

const {
  getProjectMock,
  setProjectSyncModeMock,
  syncNowMock,
  upsertMappingMock,
  removeMappingMock,
  getProjectConflictsMock,
  getMachinesMock,
} = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  setProjectSyncModeMock: vi.fn(),
  syncNowMock: vi.fn(),
  upsertMappingMock: vi.fn(),
  removeMappingMock: vi.fn(),
  getProjectConflictsMock: vi.fn(),
  getMachinesMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  getProject: getProjectMock,
  setProjectSyncMode: setProjectSyncModeMock,
  syncNow: syncNowMock,
  upsertMapping: upsertMappingMock,
  removeMapping: removeMappingMock,
  getProjectConflicts: getProjectConflictsMock,
  getMachines: getMachinesMock,
}));

// Same rationale as Projects.test.tsx: this is a unit test for the screen,
// not for routing itself — a plain anchor stands in for <Link>.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({
      to,
      children,
      ...props
    }: {
      to: string;
      children?: ReactNode;
      [key: string]: unknown;
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

// Imported after the mocks above so it picks up the mocked modules.
import { ProjectDetail } from "./ProjectDetail.js";

const NOW = Date.now();

const PROJECT = {
  id: 1,
  alias: "dotfiles",
  sync_mode: "auto" as const,
  created_at: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
  mappings: [
    { machine_id: 10, local_path: "/home/ada/dotfiles", alias: "Laptop" },
    { machine_id: 11, local_path: "/home/ada2/dotfiles", alias: "Desktop" },
  ],
  tracked_files: 42,
  last_sync_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
  activity: [
    {
      id: 1,
      user_id: 1,
      machine_id: 10,
      project_id: 1,
      type: "push",
      filename: "notes.md",
      bytes: 128,
      latency_ms: 12,
      created_at: new Date(NOW - 60 * 1000).toISOString(),
    },
  ],
};

const MACHINES: PublicMachine[] = [
  {
    id: 10,
    name: "laptop",
    os: "mac",
    os_version: null,
    label: "Laptop",
    agent_version: null,
    last_ip: null,
    status: "online",
    last_seen_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 12,
    name: "server",
    os: "linux",
    os_version: null,
    label: "Server",
    agent_version: null,
    last_ip: null,
    status: "online",
    last_seen_at: null,
    created_at: new Date().toISOString(),
  },
];

const CONFLICTS: Conflict[] = [
  {
    id: 1,
    project_id: 1,
    filename: "readme.md",
    status: "open",
    auto_merged: false,
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    project_id: 1,
    filename: "old.txt",
    status: "resolved",
    auto_merged: true,
    created_at: new Date().toISOString(),
  },
];

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return { ui: <QueryClientProvider client={qc}>{ui}</QueryClientProvider>, invalidateSpy };
}

beforeEach(() => {
  getProjectMock.mockReset();
  setProjectSyncModeMock.mockReset();
  syncNowMock.mockReset();
  upsertMappingMock.mockReset();
  removeMappingMock.mockReset();
  getProjectConflictsMock.mockReset();
  getMachinesMock.mockReset();
  navigateMock.mockReset();

  getProjectConflictsMock.mockResolvedValue(CONFLICTS);
  getMachinesMock.mockResolvedValue(MACHINES);

  // jsdom doesn't implement scrollIntoView or pointer capture, both of which
  // Radix Select touches when opening/positioning its listbox — without
  // these no-op stubs, opening the Select throws inside jsdom.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("ProjectDetail", () => {
  it("renders skeleton placeholders while the project is loading", async () => {
    getProjectMock.mockReturnValue(new Promise(() => {}));

    const { ui } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
  });

  it("renders header, stats, mappings, activity, and open conflicts once loaded", async () => {
    getProjectMock.mockResolvedValue(PROJECT);

    const { ui } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());
    expect(screen.getByText("Auto")).toBeDefined();

    // stats row
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText(timeAgo(PROJECT.last_sync_at))).toBeDefined();

    // mappings section
    expect(screen.getByText("Laptop")).toBeDefined();
    expect(screen.getByText("/home/ada/dotfiles")).toBeDefined();
    expect(screen.getByText("Desktop")).toBeDefined();
    expect(screen.getByText("/home/ada2/dotfiles")).toBeDefined();
    expect(screen.getByRole("button", { name: /add mapping/i })).toBeDefined();
    expect(screen.getAllByRole("button", { name: /remove mapping/i }).length).toBe(2);

    // activity feed
    expect(screen.getByText("notes.md")).toBeDefined();

    // open conflicts (only the "open" one, not the "resolved" one)
    await waitFor(() => expect(screen.getByText("readme.md")).toBeDefined());
    expect(screen.queryByText("old.txt")).toBeNull();
    const conflictsLink = screen.getByRole("link", { name: /resolve in conflicts/i });
    expect(conflictsLink.getAttribute("href")).toBe("/conflicts");
  });

  it("triggers a sync when 'Sync now' is clicked", async () => {
    getProjectMock.mockResolvedValue(PROJECT);
    syncNowMock.mockResolvedValue({ status: "triggered" });

    const { ui } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => expect(syncNowMock).toHaveBeenCalledWith(1));
  });

  it("changes sync mode via the select, calls setProjectSyncMode, and invalidates the project + projects list", async () => {
    getProjectMock.mockResolvedValue(PROJECT);
    setProjectSyncModeMock.mockResolvedValue({ ...PROJECT, sync_mode: "manual" });

    const { ui, invalidateSpy } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());

    const trigger = screen.getByRole("combobox", { name: /sync mode/i });
    fireEvent.click(trigger);

    const option = await screen.findByRole("option", { name: /manual/i });
    fireEvent.click(option);

    await waitFor(() =>
      expect(setProjectSyncModeMock).toHaveBeenCalledWith(1, { sync_mode: "manual" }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects", 1] })),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects"] })),
    );
  });

  it("adds a mapping via the Add mapping dialog and invalidates the project", async () => {
    getProjectMock.mockResolvedValue(PROJECT);
    upsertMappingMock.mockResolvedValue({ project_id: 1, machine_id: 12, local_path: "/srv/dotfiles" });

    const { ui, invalidateSpy } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /add mapping/i }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(getMachinesMock).toHaveBeenCalled());

    const machineTrigger = within(dialog).getByRole("combobox", { name: /machine/i });
    fireEvent.click(machineTrigger);
    fireEvent.click(await screen.findByRole("option", { name: /server/i }));

    fireEvent.change(within(dialog).getByLabelText(/local folder path/i), {
      target: { value: "/srv/dotfiles" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /add mapping/i }));

    await waitFor(() =>
      expect(upsertMappingMock).toHaveBeenCalledWith(1, 12, { local_path: "/srv/dotfiles" }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects", 1] })),
    );
  });

  it("removes a mapping via the remove action's confirm dialog", async () => {
    getProjectMock.mockResolvedValue(PROJECT);
    removeMappingMock.mockResolvedValue({ ok: true });

    const { ui, invalidateSpy } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /remove mapping for laptop/i }));

    const alert = await screen.findByRole("alertdialog");
    expect(alert.textContent).toMatch(/laptop/i);
    fireEvent.click(within(alert).getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(removeMappingMock).toHaveBeenCalledWith(1, 10));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects", 1] })),
    );
  });

  it("shows a friendly not-found panel when getProject rejects with a 404", async () => {
    getProjectMock.mockRejectedValue(new ApiError(404, "not_found", "Project not found"));

    const { ui } = wrap(<ProjectDetail projectId={999} />);
    render(ui);

    await waitFor(() => expect(screen.getByText(/project not found/i)).toBeDefined());
    expect(screen.getAllByRole("link", { name: /back to projects/i }).length).toBeGreaterThan(0);
  });

  it("renders an error panel for a non-404 ApiError", async () => {
    getProjectMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));

    const { ui } = wrap(<ProjectDetail projectId={1} />);
    render(ui);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/));
  });
});
