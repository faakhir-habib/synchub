import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./AppShell.js";
import { AuthProvider } from "../auth/auth-context.js";
import { ThemeProvider } from "../theme/theme-provider.js";

const { getMeMock, logoutMock, setAuthTokenMock, getNotificationsMock } = vi.hoisted(() => ({
  getMeMock: vi.fn(),
  logoutMock: vi.fn(),
  setAuthTokenMock: vi.fn(),
  getNotificationsMock: vi.fn(),
}));

vi.mock("../lib/endpoints.js", () => ({
  login: vi.fn(),
  signup: vi.fn(),
  logout: logoutMock,
  getMe: getMeMock,
  // Topbar (rendered as part of AppShell) reads qk.notifications for its
  // live bell badge — see shell/Topbar.tsx and routes/Notifications.tsx.
  getNotifications: getNotificationsMock,
}));

vi.mock("../lib/api.js", () => ({
  setAuthToken: setAuthTokenMock,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getHealth: vi.fn(),
}));

const ME = {
  id: 1,
  email: "ada@example.com",
  name: "Ada Lovelace",
  notify_webhook_url: null,
  notify_conflicts: true,
  notify_sync: true,
};

function PageA() {
  return <div>PAGE A</div>;
}
function PageB() {
  return <div>PAGE B</div>;
}

// A tiny router tree mirroring the shape of the real one: AppShell as the
// pathless "_app" layout, two children standing in for real routes.
function buildRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: AppShell,
  });
  const routeA = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/",
    component: PageA,
  });
  const routeB = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/projects",
    component: PageB,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([routeA, routeB])]);
  const history = createMemoryHistory({ initialEntries: ["/"] });
  return createRouter({ routeTree, history });
}

function renderShell() {
  const qc = new QueryClient();
  const router = buildRouter();
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("synchub_token", "tok-abc");
  getMeMock.mockReset().mockResolvedValue(ME);
  logoutMock.mockReset().mockResolvedValue({ ok: true });
  setAuthTokenMock.mockReset();
  getNotificationsMock.mockReset().mockResolvedValue({ unread: 0, items: [] });

  // jsdom has no matchMedia implementation — ThemeProvider (and the topbar's
  // theme toggle) call it unconditionally when theme === "system".
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("renders the sidebar nav, the topbar, and the active outlet content", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByText("PAGE A")).toBeDefined());

    expect(screen.getByRole("link", { name: /dashboard/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /projects/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /machines/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /conflicts/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /notifications/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /settings/i })).toBeDefined();

    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeDefined();

    // user chip / menu, sourced from the mocked `me()` response
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeDefined());
  });

  it("persists the shell across navigation — only the outlet content swaps", async () => {
    const router = renderShell();
    await waitFor(() => expect(screen.getByText("PAGE A")).toBeDefined());

    const sidebarBefore = screen.getByTestId("app-sidebar");

    await router.navigate({ to: "/projects" });

    await waitFor(() => expect(screen.getByText("PAGE B")).toBeDefined());
    expect(screen.queryByText("PAGE A")).toBeNull();

    // Same DOM node — the shell never unmounted/remounted, only <Outlet/> swapped.
    const sidebarAfter = screen.getByTestId("app-sidebar");
    expect(sidebarAfter).toBe(sidebarBefore);
  });
});
