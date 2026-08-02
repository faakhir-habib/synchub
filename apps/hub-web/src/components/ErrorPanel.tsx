import { TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/api-error";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * Inline error card for a failed query/mutation — an `ApiError` renders its
 * server-provided message, anything else falls back to a generic one.
 * Shared by Dashboard and Projects (and future Phase 3 screens).
 */
export function ErrorPanel({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{errorMessage(error)}</span>
    </div>
  );
}
