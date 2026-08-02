import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationsSummary } from "@synchub/shared";
import { ApiError } from "../lib/api-error.js";
import { timeAgo } from "../lib/format.js";

const { getNotificationsMock, markNotificationReadMock, markAllNotificationsReadMock } = vi.hoisted(
  () => ({
    getNotificationsMock: vi.fn(),
    markNotificationReadMock: vi.fn(),
    markAllNotificationsReadMock: vi.fn(),
  }),
);

vi.mock("@/lib/endpoints", () => ({
  getNotifications: getNotificationsMock,
  markNotificationRead: markNotificationReadMock,
  markAllNotificationsRead: markAllNotificationsReadMock,
}));

// Imported after the mocks above so it picks up the mocked module.
import { Notifications } from "./Notifications.js";

const NOW = Date.now();

const SUMMARY: NotificationsSummary = {
  unread: 2,
  items: [
    {
      id: 1,
      type: "conflict",
      title: "Conflict in notes/plan.md",
      body: "field-notes diverged on machine laptop-2.",
      read: false,
      created_at: new Date(NOW - 5 * 60_000).toISOString(),
    },
    {
      id: 2,
      type: "sync",
      title: "toolkit synced",
      body: null,
      read: false,
      created_at: new Date(NOW - 3_600_000).toISOString(),
    },
    {
      id: 3,
      type: "info",
      title: "Welcome to SyncHub",
      body: "Pair a machine to get started.",
      read: true,
      created_at: new Date(NOW - 86_400_000).toISOString(),
    },
  ],
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return { ui: <QueryClientProvider client={qc}>{ui}</QueryClientProvider>, invalidateSpy };
}

beforeEach(() => {
  getNotificationsMock.mockReset();
  markNotificationReadMock.mockReset();
  markAllNotificationsReadMock.mockReset();
});

describe("Notifications", () => {
  it("renders skeleton placeholders while loading", async () => {
    getNotificationsMock.mockReturnValue(new Promise(() => {}));

    const { ui } = wrap(<Notifications />);
    render(ui);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
  });

  it("renders a row per notification with title, body, type badge, and time", async () => {
    getNotificationsMock.mockResolvedValue(SUMMARY);

    const { ui } = wrap(<Notifications />);
    render(ui);

    await waitFor(() => expect(screen.getByText("Conflict in notes/plan.md")).toBeDefined());
    expect(screen.queryAllByTestId("skeleton").length).toBe(0);

    expect(screen.getByText("field-notes diverged on machine laptop-2.")).toBeDefined();
    expect(screen.getByText("toolkit synced")).toBeDefined();
    expect(screen.getByText("Welcome to SyncHub")).toBeDefined();

    expect(screen.getByText(timeAgo(SUMMARY.items[0].created_at))).toBeDefined();

    // Type badges — exact match so these don't collide with the titles
    // above, which also contain the words "Conflict"/"synced".
    expect(screen.getByText("conflict", { exact: true })).toBeDefined();
    expect(screen.getByText("sync", { exact: true })).toBeDefined();
  });

  it("shows an unread indicator only on unread items", async () => {
    getNotificationsMock.mockResolvedValue(SUMMARY);

    const { ui } = wrap(<Notifications />);
    render(ui);

    await waitFor(() => expect(screen.getByText("Conflict in notes/plan.md")).toBeDefined());

    const unreadRow = screen.getByText("Conflict in notes/plan.md").closest("[data-notification-id]");
    const readRow = screen.getByText("Welcome to SyncHub").closest("[data-notification-id]");

    expect(unreadRow?.getAttribute("data-read")).toBe("false");
    expect(readRow?.getAttribute("data-read")).toBe("true");

    // Only unread items get a "Mark read" action.
    expect(within(unreadRow as HTMLElement).getByRole("button", { name: /mark read/i })).toBeDefined();
    expect(within(readRow as HTMLElement).queryByRole("button", { name: /mark read/i })).toBeNull();
  });

  it("calls markNotificationRead and invalidates notifications when marking a single item read", async () => {
    getNotificationsMock.mockResolvedValue(SUMMARY);
    markNotificationReadMock.mockResolvedValue({ ok: true });

    const { ui, invalidateSpy } = wrap(<Notifications />);
    render(ui);

    await waitFor(() => expect(screen.getByText("Conflict in notes/plan.md")).toBeDefined());

    const unreadRow = screen.getByText("Conflict in notes/plan.md").closest("[data-notification-id]") as HTMLElement;
    fireEvent.click(within(unreadRow).getByRole("button", { name: /mark read/i }));

    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["notifications"] })),
    );
  });

  it("renders a 'Mark all read' button that calls markAllNotificationsRead and invalidates notifications", async () => {
    getNotificationsMock.mockResolvedValue(SUMMARY);
    markAllNotificationsReadMock.mockResolvedValue({ ok: true });

    const { ui, invalidateSpy } = wrap(<Notifications />);
    render(ui);

    const button = await screen.findByRole("button", { name: /mark all read/i });
    // The button exists (disabled) even before the query resolves — wait for
    // the unread count to load before asserting it's enabled.
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);

    await waitFor(() => expect(markAllNotificationsReadMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["notifications"] })),
    );
  });

  it("disables 'Mark all read' when there are no unread notifications", async () => {
    getNotificationsMock.mockResolvedValue({ unread: 0, items: SUMMARY.items.map((i) => ({ ...i, read: true })) });

    const { ui } = wrap(<Notifications />);
    render(ui);

    const button = await screen.findByRole("button", { name: /mark all read/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders an empty state when there are no notifications", async () => {
    getNotificationsMock.mockResolvedValue({ unread: 0, items: [] });

    const { ui } = wrap(<Notifications />);
    render(ui);

    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeDefined());
  });

  it("renders an error panel when loading notifications fails with an ApiError", async () => {
    getNotificationsMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));

    const { ui } = wrap(<Notifications />);
    render(ui);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/));
  });
});
