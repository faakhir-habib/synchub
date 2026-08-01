import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse } from "@synchub/shared";
import { setAuthToken } from "../lib/api.js";
import {
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
  getMe,
} from "../lib/endpoints.js";
import { ApiError } from "../lib/api-error.js";

/** localStorage key the bearer token is persisted under across reloads. */
export const AUTH_TOKEN_STORAGE_KEY = "synchub_token";

interface AuthContextValue {
  user: MeResponse | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MeResponse | null>(null);
  // Starts true so a hard reload with a stored token never flashes /login
  // before we've had a chance to rehydrate the session (see router guard).
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    setAuthToken(stored);
    setToken(stored);

    getMe()
      .then((me) => setUser(me))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
          setAuthToken(null);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin({ email, password });
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, res.token);
    setAuthToken(res.token);
    setToken(res.token);
    const me = await getMe();
    setUser(me);
  }, []);

  const signup = useCallback(async (email: string, password: string, name?: string) => {
    const res = await apiSignup({ email, password, name });
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, res.token);
    setAuthToken(res.token);
    setToken(res.token);
    const me = await getMe();
    setUser(me);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => {
      // best-effort — clear local session state even if the network call fails
    });
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
