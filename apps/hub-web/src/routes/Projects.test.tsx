import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@synchub/shared";
import { ApiError } from "../lib/api-error.js";

const { getProjectsMock, createProjectMock, deleteProjectMock } = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  createProjectMock: vi.fn(),
  deleteProjectMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  getProjects: getProjectsMock,
  createProject: createProjectMock,
  deleteProject: deleteProjectMock,
}));

// The real <Link>/useNavigate need a RouterProvider + registered route tree.
// This is a unit test for the Projects screen, not for routing itself, so a
// plain anchor stands in for <Link> and useNavigate is a no-op spy.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
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
import { Projects } from "./Projects.js";

const PROJECTS: Project[] = [
  { id: 1, alias: "dotfiles", sync_mode: "auto", created_at: new Date().toISOString() },
  { id: 2, alias: "notes", sync_mode: "manual", created_at: new Date().toISOString() },
  { id: 3, alias: "archive", sync_mode: "stopped", created_at: new Date().toISOString() },
];

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return { ui: <QueryClientProvider client={qc}>{ui}</QueryClientProvider>, invalidateSpy };
}

beforeEach(() => {
  getProjectsMock.mockReset();
  createProjectMock.mockReset();
  deleteProjectMock.mockReset();
  navigateMock.mockReset();
});

describe("Projects", () => {
  it("renders skeleton placeholders while projects are loading", async () => {
    getProjectsMock.mockReturnValue(new Promise(() => {}));

    const { ui } = wrap(<Projects />);
    render(ui);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
  });

  it("renders a row per project with alias, sync-mode badge, and relative created time", async () => {
    getProjectsMock.mockResolvedValue(PROJECTS);

    const { ui } = wrap(<Projects />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());
    expect(screen.getByText("notes")).toBeDefined();
    expect(screen.getByText("archive")).toBeDefined();

    expect(screen.getByText("Auto")).toBeDefined();
    expect(screen.getByText("Manual")).toBeDefined();
    expect(screen.getByText("Stopped")).toBeDefined();

    expect(screen.getAllByText("just now").length).toBe(3);
    expect(screen.queryAllByTestId("skeleton").length).toBe(0);
  });

  it("renders an empty state with a create CTA when there are no projects", async () => {
    getProjectsMock.mockResolvedValue([]);

    const { ui } = wrap(<Projects />);
    render(ui);

    await waitFor(() => expect(screen.getByText(/no projects yet/i)).toBeDefined());
  });

  it("renders an error panel when listing projects fails with an ApiError", async () => {
    getProjectsMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));

    const { ui } = wrap(<Projects />);
    render(ui);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/));
  });

  it("opens the create-project dialog from the header button, submits, and invalidates the projects list", async () => {
    getProjectsMock.mockResolvedValue(PROJECTS);
    createProjectMock.mockResolvedValue({
      id: 4,
      alias: "new-proj",
      sync_mode: "auto",
      created_at: new Date().toISOString(),
    });

    const { ui, invalidateSpy } = wrap(<Projects />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /new project/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/alias/i), { target: { value: "new-proj" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create project/i }));

    // useMutation (TanStack Query v5) invokes mutationFn(variables, context) —
    // only the first (real) argument matters here.
    await waitFor(() => expect(createProjectMock.mock.calls[0]?.[0]).toEqual({ alias: "new-proj", sync_mode: "auto" }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects"] })),
    );
  });

  it("confirms delete via an AlertDialog, calls deleteProject, and invalidates the projects list", async () => {
    getProjectsMock.mockResolvedValue(PROJECTS);
    deleteProjectMock.mockResolvedValue({ ok: true });

    const { ui, invalidateSpy } = wrap(<Projects />);
    render(ui);

    await waitFor(() => expect(screen.getByText("dotfiles")).toBeDefined());

    const row = screen.getByText("dotfiles").closest("tr") as HTMLElement;
    // jsdom doesn't implement PointerEvent, which is what Radix's
    // DropdownMenuTrigger normally opens on — the keyboard path (Enter)
    // is a real, accessible way to open it and works reliably in jsdom.
    fireEvent.keyDown(within(row).getByRole("button", { name: /open row actions/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    const alert = await screen.findByRole("alertdialog");
    expect(alert.textContent).toMatch(/dotfiles/i);
    fireEvent.click(within(alert).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects"] })),
    );
  });
});
