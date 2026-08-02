/**
 * Module-level registry for a single "the session just went invalid" callback.
 *
 * `api.ts`'s `request()` lives outside React and has no access to auth state
 * or the router, but it's the one place that sees every 401 from every
 * query/mutation. `AuthProvider` registers a handler here (on mount) that
 * clears the session; `request()` invokes it right before throwing an
 * `ApiError` with `status === 401`, so a token expiring/revoked mid-session
 * is handled the same way as a failed initial rehydration — the existing
 * `AuthGuard` redirects to `/login` once `token` clears.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function notifyUnauthorized() {
  onUnauthorized?.();
}
