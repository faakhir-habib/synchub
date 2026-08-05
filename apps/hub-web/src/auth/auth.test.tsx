import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiError } from "../lib/api-error.js";

const { loginMock, signupMock, logoutMock, getMeMock, setAuthTokenMock, navigateMock } =
  vi.hoisted(() => ({
    loginMock: vi.fn(),
    signupMock: vi.fn(),
    logoutMock: vi.fn(),
    getMeMock: vi.fn(),
    setAuthTokenMock: vi.fn(),
    navigateMock: vi.fn(),
  }));

vi.mock("../lib/endpoints.js", () => ({
  login: loginMock,
  signup: signupMock,
  logout: logoutMock,
  getMe: getMeMock,
}));

vi.mock("../lib/api.js", () => ({
  setAuthToken: setAuthTokenMock,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getHealth: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    Navigate: () => null,
  };
});

// Imported after the mocks above so they pick up the mocked modules.
import { AuthProvider, useAuth } from "./auth-context.js";
import { Login } from "./Login.js";

const ME = {
  id: 1,
  email: "a@b.com",
  name: null,
  notify_webhook_url: null,
  notify_sync: true,
};

function AuthProbe() {
  const { user, token } = useAuth();
  return (
    <div>
      <span data-testid="probe-token">{token ?? "none"}</span>
      <span data-testid="probe-user">{user ? user.email : "none"}</span>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  loginMock.mockReset();
  signupMock.mockReset();
  logoutMock.mockReset();
  getMeMock.mockReset();
  setAuthTokenMock.mockReset();
  navigateMock.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Login", () => {
  it("logs in, persists the token, syncs the api client, and navigates home", async () => {
    loginMock.mockResolvedValue({ token: "tok-123", user: { id: 1, email: "a@b.com" } });
    getMeMock.mockResolvedValue(ME);

    render(
      <AuthProvider>
        <Login />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({ email: "a@b.com", password: "password123" }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem("synchub_token")).toBe("tok-123"),
    );
    expect(setAuthTokenMock).toHaveBeenCalledWith("tok-123");
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/" }));
  });

  it("shows an error message in the form when login rejects with an ApiError", async () => {
    loginMock.mockRejectedValue(new ApiError(401, "invalid_credentials", "Invalid email or password"));

    render(
      <AuthProvider>
        <Login />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Invalid email or password"),
    );
    expect(navigateMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("synchub_token")).toBeNull();
  });
});

describe("useAuth", () => {
  it("exposes user and token after a successful login", async () => {
    loginMock.mockResolvedValue({ token: "tok-456", user: { id: 1, email: "a@b.com" } });
    getMeMock.mockResolvedValue(ME);

    function Harness() {
      const { login } = useAuth();
      return (
        <div>
          <button onClick={() => login("a@b.com", "password123")}>do-login</button>
          <AuthProbe />
        </div>
      );
    }

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByText("do-login"));

    await waitFor(() =>
      expect(screen.getByTestId("probe-token").textContent).toBe("tok-456"),
    );
    expect(screen.getByTestId("probe-user").textContent).toBe("a@b.com");
  });

  it("logout clears token, user, and localStorage", async () => {
    window.localStorage.setItem("synchub_token", "existing-tok");
    getMeMock.mockResolvedValue(ME);
    logoutMock.mockResolvedValue({ ok: true });

    function Harness() {
      const { logout } = useAuth();
      return (
        <div>
          <button onClick={() => logout()}>do-logout</button>
          <AuthProbe />
        </div>
      );
    }

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    // wait for rehydration from the stored token to finish
    await waitFor(() =>
      expect(screen.getByTestId("probe-user").textContent).toBe("a@b.com"),
    );

    fireEvent.click(screen.getByText("do-logout"));

    await waitFor(() =>
      expect(screen.getByTestId("probe-token").textContent).toBe("none"),
    );
    expect(screen.getByTestId("probe-user").textContent).toBe("none");
    expect(window.localStorage.getItem("synchub_token")).toBeNull();
    expect(setAuthTokenMock).toHaveBeenCalledWith(null);
  });
});
