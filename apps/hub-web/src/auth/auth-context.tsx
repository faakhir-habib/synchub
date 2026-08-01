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

// Backoff (ms) between rehydration retries on a non-401 getMe() failure
// (network blip, 5xx, etc.) — 1 initial attempt + these 2 retries.
const REHYDRATE_RETRY_DELAYS_MS = [300, 800];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    // Guards against StrictMode's dev-mode double-invoke applying a result
    // (or scheduling a retry) after this effect instance has been torn down.
    let cancelled = false;

    const stored = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    setAuthToken(stored);
    setToken(stored);

    async function rehydrate() {
      for (let attempt = 0; attempt <= REHYDRATE_RETRY_DELAYS_MS.length; attempt++) {
        if (cancelled) return;
        try {
          const me = await getMe();
          if (!cancelled) setUser(me);
          return;
        } catch (err) {
          if (cancelled) return;

          if (err instanceof ApiError && err.status === 401) {
            // Session is actually invalid — clear it, no point retrying.
            window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
            setAuthToken(null);
            setToken(null);
            setUser(null);
            return;
          }

          const hasRetryLeft = attempt < REHYDRATE_RETRY_DELAYS_MS.length;
          if (!hasRetryLeft) {
            // Exhausted retries on a non-401 error (network blip, 5xx,
            // bad response shape, ...). Keep the token — it may still be
            // valid, this may just be a transient failure — but leave
            // `user` null. isLoading still flips false below so the app
            // renders instead of hanging on the splash forever.
            return;
          }
          await delay(REHYDRATE_RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    rehydrate().finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
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
