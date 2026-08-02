import type { ZodError } from "zod";

/**
 * Flattens a ZodError into a { fieldName: firstMessage } map suitable for
 * rendering inline under each form input. Only the first issue per field is
 * kept — good enough for the simple login/signup forms.
 */
export function collectFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) {
      out[key] = issue.message;
    }
  }
  return out;
}
