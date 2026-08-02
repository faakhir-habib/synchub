import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicMachine } from "@synchub/shared";
import { ApiError } from "../lib/api-error.js";
import { timeAgo } from "../lib/format.js";
import { setPresence } from "../realtime/presence-store.js";

const { getMachinesMock, createMachineMock, deleteMachineMock, pairMachineMock } = vi.hoisted(() => ({
  getMachinesMock: vi.fn(),
  createMachineMock: vi.fn(),
  deleteMachineMock: vi.fn(),
  pairMachineMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  getMachines: getMachinesMock,
  createMachine: createMachineMock,
  deleteMachine: deleteMachineMock,
  pairMachine: pairMachineMock,
}));

// Imported after the mock above so it picks up the mocked module.
import { Machines } from "./Machines.js";

const NOW = Date.now();

// Ids in the 1xxx/2xxx/3xxx/4xxx ranges per test below — the presence store
// is a module-level singleton that isn't reset between tests, so distinct
// machine ids keep each test's presence state isolated from the others.
const MACHINES: PublicMachine[] = [
  {
    id: 1001,
    name: "atlas",
    os: "macOS",
    os_version: "14.5",
    label: "Atlas laptop",
    agent_version: "1.2.0",
    last_ip: "192.168.1.10",
    status: "online",
    last_seen_at: new Date(NOW - 60_000).toISOString(),
    created_at: new Date(NOW - 86_400_000).toISOString(),
  },
  {
    id: 1002,
    name: "forge",
    os: "Linux",
    os_version: "Ubuntu 22.04",
    label: null,
    agent_version: "1.1.0",
    last_ip: "10.0.0.5",
    status: "offline",
    last_seen_at: new Date(NOW - 3_600_000).toISOString(),
    created_at: new Date(NOW - 172_800_000).toISOString(),
  },
];

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return { ui: <QueryClientProvider client={qc}>{ui}</QueryClientProvider>, invalidateSpy };
}

beforeEach(() => {
  getMachinesMock.mockReset();
  createMachineMock.mockReset();
  deleteMachineMock.mockReset();
  pairMachineMock.mockReset();

  // jsdom doesn't implement scrollIntoView or pointer capture — not touched
  // by this screen's Dialog/AlertDialog, but stubbed defensively per the
  // established pattern in case a future Select is added here.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("Machines", () => {
  it("renders skeleton placeholders while machines are loading", async () => {
    getMachinesMock.mockReturnValue(new Promise(() => {}));

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
  });

  it("renders a row per machine with name, os, presence, last-seen, and last IP", async () => {
    getMachinesMock.mockResolvedValue(MACHINES);

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText("atlas")).toBeDefined());
    expect(screen.getByText("forge")).toBeDefined();
    expect(screen.queryAllByTestId("skeleton").length).toBe(0);

    const atlasRow = screen.getByText("atlas").closest("tr") as HTMLElement;
    expect(within(atlasRow).getByText(/macOS/)).toBeDefined();
    expect(within(atlasRow).getByText("192.168.1.10")).toBeDefined();
    expect(within(atlasRow).getByText(timeAgo(MACHINES[0].last_seen_at!))).toBeDefined();
    // No presence-store entry yet for id 1001 — falls back to the API's
    // status ("online").
    expect(within(atlasRow).getByText(/online/i)).toBeDefined();

    const forgeRow = screen.getByText("forge").closest("tr") as HTMLElement;
    expect(within(forgeRow).getByText(/linux/i)).toBeDefined();
    expect(within(forgeRow).getByText("10.0.0.5")).toBeDefined();
    // Falls back to the API's status ("offline") for id 1002 too.
    expect(within(forgeRow).getByText(/offline/i)).toBeDefined();
  });

  it("flips a row's presence indicator live when setPresence is called, without a refetch", async () => {
    const machine: PublicMachine = { ...MACHINES[0], id: 2001, name: "beacon" };
    getMachinesMock.mockResolvedValue([machine]);

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText("beacon")).toBeDefined());
    const row = screen.getByText("beacon").closest("tr") as HTMLElement;
    expect(within(row).getByText(/online/i)).toBeDefined();

    act(() => {
      setPresence(2001, { status: "offline", lastSeenAt: new Date().toISOString() });
    });

    await waitFor(() => expect(within(row).getByText(/offline/i)).toBeDefined());
    expect(within(row).queryByText(/^online$/i)).toBeNull();
  });

  it("renders an empty state with a connect CTA when there are no machines", async () => {
    getMachinesMock.mockResolvedValue([]);

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText(/no machines connected/i)).toBeDefined());
  });

  it("renders an error panel when listing machines fails with an ApiError", async () => {
    getMachinesMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/));
  });

  it("opens the create-machine dialog, submits, reveals the one-time token, and invalidates the machines list", async () => {
    getMachinesMock.mockResolvedValue([{ ...MACHINES[0], id: 3001, name: "citadel" }]);
    createMachineMock.mockResolvedValue({
      id: 3002,
      name: "new-machine",
      os: null,
      os_version: null,
      label: null,
      agent_version: null,
      last_ip: null,
      status: "offline",
      last_seen_at: null,
      created_at: new Date().toISOString(),
      token: "shtok_abcdef123456",
    });

    const { ui, invalidateSpy } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText("citadel")).toBeDefined());

    // jsdom doesn't implement PointerEvent, which is what DropdownMenuTrigger
    // normally opens on — the keyboard path (Enter) is a real, accessible way
    // to open it and works reliably in jsdom.
    fireEvent.keyDown(screen.getByRole("button", { name: /connect machine/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /create manually/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "new-machine" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /connect machine/i }));

    await waitFor(() =>
      expect(createMachineMock.mock.calls[0]?.[0]).toEqual({ name: "new-machine" }),
    );

    // One-time token reveal, with a warning that it won't be shown again.
    expect(await within(dialog).findByText("shtok_abcdef123456")).toBeDefined();
    expect(within(dialog).getByText(/won.t.*see it again/i)).toBeDefined();

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["machines"] })),
    );
  });

  it("opens the pair-machine dialog from the connect menu and generates a code", async () => {
    getMachinesMock.mockResolvedValue([{ ...MACHINES[0], id: 3201, name: "citadel" }]);
    pairMachineMock.mockResolvedValue({ code: "AB12CD", expires_in: 600 });

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText("citadel")).toBeDefined());

    fireEvent.keyDown(screen.getByRole("button", { name: /connect machine/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /pair a machine/i }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("AB12CD")).toBeDefined();
    expect(pairMachineMock).toHaveBeenCalledTimes(1);
  });

  it("shows an inline field error for a blank name without calling createMachine", async () => {
    getMachinesMock.mockResolvedValue([{ ...MACHINES[0], id: 3101, name: "citadel" }]);

    const { ui } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText("citadel")).toBeDefined());

    fireEvent.keyDown(screen.getByRole("button", { name: /connect machine/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /create manually/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /connect machine/i }));

    expect(await within(dialog).findByText(/enter a machine name/i)).toBeDefined();
    expect(createMachineMock).not.toHaveBeenCalled();
  });

  it("confirms delete via an AlertDialog, calls deleteMachine, and invalidates the machines list", async () => {
    getMachinesMock.mockResolvedValue([{ ...MACHINES[0], id: 4001, name: "outpost" }]);
    deleteMachineMock.mockResolvedValue({ ok: true });

    const { ui, invalidateSpy } = wrap(<Machines />);
    render(ui);

    await waitFor(() => expect(screen.getByText("outpost")).toBeDefined());

    const row = screen.getByText("outpost").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /delete outpost/i }));

    const alert = await screen.findByRole("alertdialog");
    expect(alert.textContent).toMatch(/outpost/i);
    fireEvent.click(within(alert).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteMachineMock).toHaveBeenCalledWith(4001));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["machines"] })),
    );
  });
});
