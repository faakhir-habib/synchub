import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationsSummary } from "@synchub/shared";
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

// The real useNavigate needs a RouterProvider + registered route tree. This
// is a unit test for the Topbar's bell badge, not for routing itself, so
// useNavigate is a no-op spy — same pattern as Projects.test.tsx.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Imported after the mocks above so it picks up the mocked modules.
import { Topbar } from "./Topbar.js";

const ME = {
  id: 1,
  email: "ada@example.com",
  name: "Ada Lovelace",
  notify_webhook_url: null,
  notify_conflicts: true,
  notify_sync: true,
};

function summary(unread: number): NotificationsSummary {
  return { unread, items: [] };
}

function renderTopbar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Topbar onMenuClick={() => {}} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  getMeMock.mockReset().mockResolvedValue(ME);
  logoutMock.mockReset().mockResolvedValue({ ok: true });
  setAuthTokenMock.mockReset();
  getNotificationsMock.mockReset();
  navigateMock.mockReset();

  // jsdom has no matchMedia implementation — ThemeProvider calls it
  // unconditionally when theme === "system".
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

describe("Topbar bell badge", () => {
  it("shows the unread count on the bell when there are unread notifications", async () => {
    getNotificationsMock.mockResolvedValue(summary(3));

    renderTopbar();

    const bell = await screen.findByRole("button", { name: /notifications/i });
    await waitFor(() => expect(bell.textContent).toContain("3"));
  });

  it("shows no badge when there are no unread notifications", async () => {
    getNotificationsMock.mockResolvedValue(summary(0));

    renderTopbar();

    const bell = await screen.findByRole("button", { name: /notifications/i });
    await waitFor(() => expect(getNotificationsMock).toHaveBeenCalled());
    expect(bell.textContent).toBe("");
  });

  it("caps the badge at '9+' for large unread counts", async () => {
    getNotificationsMock.mockResolvedValue(summary(42));

    renderTopbar();

    const bell = await screen.findByRole("button", { name: /notifications/i });
    await waitFor(() => expect(bell.textContent).toContain("9+"));
  });
});
