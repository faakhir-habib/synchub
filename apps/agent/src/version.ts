import { readFileSync } from "node:fs";

// Read the package.json at runtime instead of a static JSON import: `tsc`
// with NodeNext module resolution does not reliably copy/resolve a relative
// JSON import into dist, so a `with { type: "json" }` import can break the
// compiled output even though it typechecks. Resolving relative to this
// module's URL works identically from src (via tsx) and from dist (via
// node), and keeps the real package.json version as the single source of
// truth (no hardcoded literal — audit #14).
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const VERSION: string = pkg.version;
