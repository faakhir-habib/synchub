// Sliding session lifetime: sessions are refreshed (extended) once their
// remaining lifetime drops below half of this window, so we don't write to
// the DB on every single authenticated request.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
