// Guards a filename before it is joined onto a local sync directory. Two shapes
// are safe: a plain top-level basename (e.g. `chat.jsonl`) or a single-level
// memory note (`memory/<basename>.md`). Everything else — deeper nesting,
// traversal (`..`), separators inside a basename, absolute paths — is rejected.
// Mirrors hub-api's `isSafeFilename` (apps/hub-api/src/sync/sync.service.ts).
import { isAbsolute } from "node:path";

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const MEMORY_PREFIX = "memory/";

/** A plain, non-traversing basename: charset-clean, no `..`, no NUL, non-empty. */
function isSafeBasename(base: string): boolean {
  if (base.length === 0) return false;
  if (base.includes("..")) return false;
  if (base.includes("\0")) return false;
  return SAFE_NAME.test(base);
}

/** True iff `name` is safe to join onto a local sync directory. */
export function isSafeFilename(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name.includes("\0")) return false;
  if (isAbsolute(name)) return false;

  if (name.startsWith(MEMORY_PREFIX)) {
    const base = name.slice(MEMORY_PREFIX.length);
    return base.endsWith(".md") && isSafeBasename(base);
  }

  if (name.includes("/") || name.includes("\\")) return false;
  return isSafeBasename(name);
}
