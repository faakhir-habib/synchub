// Guards against a Hub-supplied filename (from a `deleted` WS frame, or a
// manifest entry pulled during reconcile) being used to escape the local
// sync directory before a join(localPath, filename) fs call. Mirrors
// hub-api's `isSafeFilename` (apps/hub-api/src/sync/sync.service.ts) — same
// charset allowlist + length bound — with an explicit `..` rejection added:
// a name made up entirely of dots (e.g. "..") satisfies hub-api's
// `/^[A-Za-z0-9._-]+$/` charset regex on its own, so without an explicit
// check it would slip through as a "safe" name despite being a directory
// traversal token when joined onto a path.
import { isAbsolute } from "node:path";

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** True iff `name` is a plain, non-traversing basename safe to join onto a local directory. */
export function isSafeFilename(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("..")) return false;
  if (name.includes("\0")) return false;
  if (isAbsolute(name)) return false;
  return SAFE_NAME.test(name);
}
