import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConflictWithProjectAlias } from "@/lib/endpoints";
import { ApiError } from "../lib/api-error.js";
import { timeAgo } from "../lib/format.js";

const { getConflictsMock, resolveConflictMock, getConflictContentMock } = vi.hoisted(() => ({
  getConflictsMock: vi.fn(),
  resolveConflictMock: vi.fn(),
  getConflictContentMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  getConflicts: getConflictsMock,
  resolveConflict: resolveConflictMock,
  getConflictContent: getConflictContentMock,
}));

// The real <Link> needs a RouterProvider + registered route tree. This is a
// unit test for the Conflicts screen, not for routing itself, so a plain
// anchor stands in for <Link> — same pattern as Projects.test.tsx.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
      [key: string]: unknown;
    }) => {
      const href = params ? Object.values(params).reduce((p, v) => p.replace(/\$\w+/, v), to) : to;
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  };
});

// Imported after the mocks above so it picks up the mocked modules.
import { Conflicts } from "./Conflicts.js";

const NOW = Date.now();

const CONFLICTS: ConflictWithProjectAlias[] = [
  {
    id: 501,
    project_id: 7,
    filename: "notes/plan.md",
    status: "open",
    auto_merged: false,
    created_at: new Date(NOW - 5 * 60_000).toISOString(),
    machine_id: 3,
    candidate_hash: "abc123",
    resolved_at: null,
    project_alias: "field-notes",
  },
  {
    id: 502,
    project_id: 8,
    filename: "src/index.ts",
    status: "open",
    auto_merged: true,
    created_at: new Date(NOW - 3_600_000).toISOString(),
    machine_id: 4,
    candidate_hash: "def456",
    resolved_at: null,
    project_alias: "toolkit",
  },
];

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return { ui: <QueryClientProvider client={qc}>{ui}</QueryClientProvider>, invalidateSpy };
}

beforeEach(() => {
  getConflictsMock.mockReset();
  resolveConflictMock.mockReset();
  getConflictContentMock.mockReset();
  getConflictContentMock.mockResolvedValue({ canonical: '{"seq":1}\n', candidate: '{"seq":1}\nbad\n' });

  // jsdom doesn't implement scrollIntoView or pointer capture — needed
  // defensively for the Dialog opened by the Resolve button.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("Conflicts", () => {
  it("renders skeleton placeholders while conflicts are loading", async () => {
    getConflictsMock.mockReturnValue(new Promise(() => {}));

    const { ui } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
  });

  it("renders a row per conflict with project alias, filename, and detected time", async () => {
    getConflictsMock.mockResolvedValue(CONFLICTS);

    const { ui } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getByText("field-notes")).toBeDefined());
    expect(screen.getByText("toolkit")).toBeDefined();
    expect(screen.queryAllByTestId("skeleton").length).toBe(0);

    const notesRow = screen.getByText("field-notes").closest("tr") as HTMLElement;
    expect(within(notesRow).getByText("notes/plan.md")).toBeDefined();
    expect(within(notesRow).getByText(timeAgo(CONFLICTS[0].created_at))).toBeDefined();
    // Not auto-merged — no badge in this row.
    expect(within(notesRow).queryByText(/auto-merged/i)).toBeNull();

    const toolkitRow = screen.getByText("toolkit").closest("tr") as HTMLElement;
    expect(within(toolkitRow).getByText("src/index.ts")).toBeDefined();
    expect(within(toolkitRow).getByText(/auto-merged/i)).toBeDefined();
  });

  it("links the project alias to its detail page", async () => {
    getConflictsMock.mockResolvedValue(CONFLICTS);

    const { ui } = wrap(<Conflicts />);
    render(ui);

    const link = await screen.findByRole("link", { name: "field-notes" });
    expect(link.getAttribute("href")).toBe("/projects/7");
  });

  it("renders an empty state when there are no conflicts", async () => {
    getConflictsMock.mockResolvedValue([]);

    const { ui } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getByText(/no conflicts/i)).toBeDefined());
  });

  it("renders an error panel when listing conflicts fails with an ApiError", async () => {
    getConflictsMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));

    const { ui } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/));
  });

  it("opens the resolve dialog, keeps the candidate, calls resolveConflict, and invalidates conflicts", async () => {
    getConflictsMock.mockResolvedValue(CONFLICTS);
    resolveConflictMock.mockResolvedValue({ status: "resolved", choice: "candidate" });

    const { ui, invalidateSpy } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getByText("field-notes")).toBeDefined());

    const row = screen.getByText("field-notes").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /resolve/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/notes\/plan\.md/);
    expect(dialog.textContent).toMatch(/field-notes/);

    fireEvent.click(within(dialog).getByRole("button", { name: /keep the incoming version/i }));

    await waitFor(() => expect(resolveConflictMock).toHaveBeenCalledWith(7, 501, { choice: "candidate" }));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["conflicts"] })),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["projects", 7, "conflicts"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["dashboard", "metrics"] }),
    );
  });

  it("opens the resolve dialog and keeps the canonical version", async () => {
    getConflictsMock.mockResolvedValue(CONFLICTS);
    resolveConflictMock.mockResolvedValue({ status: "resolved", choice: "canonical" });

    const { ui } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getByText("toolkit")).toBeDefined());

    const row = screen.getByText("toolkit").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /resolve/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /keep the current synced version/i }));

    await waitFor(() =>
      expect(resolveConflictMock).toHaveBeenCalledWith(8, 502, { choice: "canonical" }),
    );
  });

  it("shows an inline error when resolving fails with an ApiError", async () => {
    getConflictsMock.mockResolvedValue(CONFLICTS);
    resolveConflictMock.mockRejectedValue(new ApiError(404, "not_found", "This conflict was already resolved."));

    const { ui } = wrap(<Conflicts />);
    render(ui);

    await waitFor(() => expect(screen.getByText("field-notes")).toBeDefined());

    const row = screen.getByText("field-notes").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /resolve/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /keep the incoming version/i }));

    expect(await within(dialog).findByText(/already resolved/i)).toBeDefined();
  });
});
