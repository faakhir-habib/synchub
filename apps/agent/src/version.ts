import { readFileSync } from "node:fs";

// Version resolution has two paths:
//
// 1. Bundled (SEA binary / esbuild bundle.cjs): esbuild's `define` bakes the
//    real package.json version into `process.env.SYNCHUB_VERSION` as a
//    string literal at build time (see scripts/build-sea.mjs). There is no
//    package.json — or even a real filesystem tree — next to the bundle
//    inside a Node SEA binary, so `import.meta.url` resolution is not an
//    option there.
// 2. Dev / plain `node`/`tsx` (src or tsc-compiled dist/cli.js, run without
//    the define): fall back to reading package.json at runtime, resolved
//    relative to this module's URL. This works identically from src (via
//    tsx) and from dist (via node) and keeps the real package.json version
//    as the single source of truth (no hardcoded literal — audit #14).
function readVersion(): string {
  const defined = process.env.SYNCHUB_VERSION;
  if (defined) return defined;
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export const VERSION: string = readVersion();
