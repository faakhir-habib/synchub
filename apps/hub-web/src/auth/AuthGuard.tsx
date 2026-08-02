import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useAuth } from "./auth-context.js";

/**
 * Wraps the "_app" layout route (see router.tsx). While the initial
 * `me()` rehydration is in flight we render a splash instead of the shell —
 * this is what prevents a login-page flash on a hard reload when a valid
 * token is already in localStorage. Once settled: no token → /login.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Loading…
        </div>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}
