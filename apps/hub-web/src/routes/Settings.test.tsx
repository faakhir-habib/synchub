import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeResponse } from "@synchub/shared";
import { ApiError } from "../lib/api-error.js";
import { ThemeProvider } from "../theme/theme-provider.js";
import { AuthProvider } from "../auth/auth-context.js";

const { getMeMock, updateMeMock, logoutMock, setAuthTokenMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    getMeMock: vi.fn(),
    updateMeMock: vi.fn(),
    logoutMock: vi.fn(),
    setAuthTokenMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock("@/lib/endpoints", () => ({
  getMe: getMeMock,
  updateMe: updateMeMock,
  login: vi.fn(),
  signup: vi.fn(),
  logout: logoutMock,
}));

// auth-context imports endpoints via the relative "../lib/endpoints.js"
// specifier (not the "@/lib/endpoints" alias Settings.tsx uses), so both
// need mocking to point at the same fns — see auth.test.tsx for precedent.
vi.mock("../lib/endpoints.js", () => ({
  getMe: getMeMock,
  updateMe: updateMeMock,
  login: vi.fn(),
  signup: vi.fn(),
  logout: logoutMock,
}));

vi.mock("../lib/api.js", () => ({
  setAuthToken: setAuthTokenMock,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getHealth: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
  Toaster: () => null,
}));

// Unit test for the screen, not for routing — useNavigate is a no-op spy,
// same pattern as Topbar.test.tsx / Machines.test.tsx.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Imported after the mocks above so it picks up the mocked modules.
import { Settings } from "./Settings.js";

const ME: MeResponse = {
  id: 7,
  email: "ada@example.com",
  name: "Ada Lovelace",
  notify_webhook_url: "https://example.com/hook",
  notify_conflicts: true,
  notify_sync: false,
};

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Settings />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { invalidateSpy };
}

beforeEach(() => {
  window.localStorage.clear();
  getMeMock.mockReset();
  updateMeMock.mockReset();
  logoutMock.mockReset();
  setAuthTokenMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  navigateMock.mockReset();

  // jsdom has no matchMedia implementation — ThemeProvider calls it
  // unconditionally when theme === "system" (see Topbar.test.tsx precedent).
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

  // jsdom doesn't implement Radix's pointer-capture / scroll APIs.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Settings", () => {
  it("renders skeleton placeholders while the profile is loading", async () => {
    getMeMock.mockReturnValue(new Promise(() => {}));

    renderSettings();

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
  });

  it("renders an error panel when loading the profile fails with an ApiError", async () => {
    getMeMock.mockRejectedValue(new ApiError(503, "unavailable", "hub-api is unreachable"));

    renderSettings();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/),
    );
  });

  it("prefills the form from getMe and shows the read-only email", async () => {
    getMeMock.mockResolvedValue(ME);

    renderSettings();

    const nameInput = (await screen.findByLabelText(/name/i)) as HTMLInputElement;
    expect(nameInput.value).toBe("Ada Lovelace");

    const webhookInput = screen.getByLabelText(/webhook/i) as HTMLInputElement;
    expect(webhookInput.value).toBe("https://example.com/hook");

    const conflictsSwitch = screen.getByRole("switch", { name: /conflicts/i });
    expect(conflictsSwitch.getAttribute("aria-checked")).toBe("true");

    const syncSwitch = screen.getByRole("switch", { name: /sync/i });
    expect(syncSwitch.getAttribute("aria-checked")).toBe("false");

    expect(screen.getByText("ada@example.com")).toBeDefined();
    // The email field itself must not be an editable input.
    expect(screen.queryByLabelText(/^email$/i)).toBeNull();
  });

  it("disables Save until the form is dirty, then saves the changed fields, invalidates qk.me, refreshes the auth user, and toasts success", async () => {
    getMeMock.mockResolvedValue(ME);
    updateMeMock.mockResolvedValue({ ...ME, name: "Grace Hopper", notify_sync: true });

    const { invalidateSpy } = renderSettings();

    const nameInput = (await screen.findByLabelText(/name/i)) as HTMLInputElement;
    const saveButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: "Grace Hopper" } });
    fireEvent.click(screen.getByRole("switch", { name: /sync/i }));

    expect(saveButton.disabled).toBe(false);

    // getMe was already called once for the screen's own qk.me query — a
    // second call after Save proves refreshUser() (which also calls getMe())
    // ran, since it isn't otherwise spy-able through the real AuthProvider.
    expect(getMeMock).toHaveBeenCalledTimes(1);

    fireEvent.click(saveButton);

    await waitFor(() => expect(updateMeMock).toHaveBeenCalledTimes(1));
    expect(updateMeMock).toHaveBeenCalledWith({
      name: "Grace Hopper",
      notify_webhook_url: "https://example.com/hook",
      notify_conflicts: true,
      notify_sync: true,
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["me"] })),
    );
    // getMe was called once for the initial load; invalidating qk.me
    // triggers its own refetch, and refreshUser() makes a further call on
    // top of that — either way, strictly more than the single initial call
    // proves refreshUser ran (it isn't otherwise spy-able through the real
    // AuthProvider).
    await waitFor(() => expect(getMeMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringMatching(/updated/i)));
  });

  it("shows an inline error when saving fails with an ApiError, without a success toast", async () => {
    getMeMock.mockResolvedValue(ME);
    updateMeMock.mockRejectedValue(new ApiError(400, "invalid_webhook", "Webhook URL must be public"));

    renderSettings();

    const nameInput = (await screen.findByLabelText(/name/i)) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Grace Hopper" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Webhook URL must be public/),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("logs out via useAuth().logout and navigates to /login when Log out is clicked", async () => {
    getMeMock.mockResolvedValue(ME);
    logoutMock.mockResolvedValue({ ok: true });

    renderSettings();

    await screen.findByLabelText(/name/i);

    fireEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/login" }));
  });
});
