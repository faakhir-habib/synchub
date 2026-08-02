#!/usr/bin/env node
// Builds a self-contained single-file executable for the SyncHub agent:
//
//   1. esbuild bundles src/cli.ts (+ everything it imports, except
//      node-notifier — see the `external` comment below) into a single CJS
//      file, dist/bundle.cjs. The real package.json version is baked in via
//      `define` so version.ts doesn't need import.meta.url/package.json
//      resolution inside the bundle (see src/version.ts).
//   2. Node's `--experimental-sea-config` turns that bundle into a
//      "preparation blob" (dist/sea-prep.blob).
//   3. A copy of the currently-running `node` binary is made at
//      dist/sea/synchub-agent[.exe], and `postject` injects the blob into
//      it under the NODE_SEA_BLOB resource with the required sentinel
//      fuse — the result is a single executable that runs the bundled CLI
//      with no separate Node/npm install required on the target machine.
//
// Run directly: `node scripts/build-sea.mjs` (bundle + assemble). No
// separate `tsc` pass is needed — esbuild bundles TypeScript directly.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, "..");

const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

const bundlePath = join(pkgDir, "dist", "bundle.cjs");
const seaConfigPath = join(pkgDir, "sea-config.json");
const blobPath = join(pkgDir, "dist", "sea-prep.blob");
const outDir = join(pkgDir, "dist", "sea");
const outBin = join(outDir, isWin ? "synchub-agent.exe" : "synchub-agent");

async function bundle() {
  console.log("[build-sea] bundling src/cli.ts -> dist/bundle.cjs");
  await build({
    absWorkingDir: pkgDir,
    entryPoints: ["src/cli.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: bundlePath,
    // node-notifier spawns vendored platform binaries at runtime that
    // cannot be bundled into a single file; keep it external so the SEA
    // binary starts cleanly. notifier.ts lazily `import()`s it and fails
    // safe (no-op) when the module isn't resolvable, which is always true
    // inside the SEA binary (there is no node_modules next to it).
    external: ["node-notifier"],
    define: {
      "process.env.SYNCHUB_VERSION": JSON.stringify(pkg.version),
      // Marks the bundle as the packaged SEA binary so `install` can tell it
      // apart from `node dist/cli.js` / `tsx` dev runs (service.ts). Baked at
      // build time, exactly like SYNCHUB_VERSION above.
      "process.env.SYNCHUB_SEA": JSON.stringify("1"),
    },
    banner: { js: "" },
    logLevel: "info",
  });
}

// The SEA "sentinel fuse" is a marker string baked into every official Node
// binary that postject searches for and flips (0 -> 1) to mark the binary
// as containing an embedded application. The commonly-documented constant
// (`NODE_SEA_FUSE_fce680ab2cc2b1fa`) is only valid for the specific set of
// fuses Node happened to ship with at the time that doc was written — the
// hash is derived from Node's full list of registered fuses, which grows
// across Node releases, so newer Node builds embed a *different* sentinel
// string. Rather than hardcode a value that silently breaks on the next
// Node upgrade, read it straight out of the binary we're about to inject
// into (same technique postject itself would use to validate the fuse).
function findSentinelFuse(binPath) {
  const buf = readFileSync(binPath);
  const marker = Buffer.from("NODE_SEA_FUSE_");
  const idx = buf.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `Could not locate a NODE_SEA_FUSE_ sentinel in ${binPath} — this Node build may not support Single Executable Applications.`,
    );
  }
  // The fuse is "NODE_SEA_FUSE_<hex-hash>:<0-or-1>" followed by a NUL or
  // other non-hex/colon byte; read forward until we hit the digit after the
  // colon and stop there (postject wants the sentinel text, not the digit).
  const tail = buf.subarray(idx, idx + 128).toString("latin1");
  const match = /^NODE_SEA_FUSE_[0-9a-f]+:/.exec(tail);
  if (!match) {
    throw new Error(`Found a NODE_SEA_FUSE_ marker in ${binPath} but couldn't parse it: ${JSON.stringify(tail.slice(0, 64))}`);
  }
  return match[0].slice(0, -1); // drop the trailing ":"
}

function assembleSea() {
  mkdirSync(outDir, { recursive: true });

  console.log("[build-sea] generating SEA blob");
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
    stdio: "inherit",
    cwd: pkgDir,
  });

  console.log(`[build-sea] copying node binary -> ${outBin}`);
  copyFileSync(process.execPath, outBin);

  if (isMac) {
    try {
      execFileSync("codesign", ["--remove-signature", outBin], { stdio: "inherit" });
    } catch (err) {
      console.warn(`[build-sea] warning: codesign --remove-signature failed (continuing): ${err.message}`);
    }
  }

  console.log("[build-sea] injecting blob with postject");
  const postjectCliPath = join(dirname(require.resolve("postject/package.json")), "dist", "cli.js");
  const sentinel = findSentinelFuse(outBin);
  const postjectArgs = [
    postjectCliPath,
    outBin,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    sentinel,
    ...(isMac ? ["--macho-segment-name", "NODE_SEA"] : []),
  ];
  // Invoke postject's CLI script directly with the current node binary
  // rather than via `npx postject ...`: npx's shell resolution can be
  // flaky on Windows (spawns a .cmd shim through cmd.exe), whereas this
  // resolves the exact script pnpm already installed and runs it with the
  // exact node binary already running this build.
  execFileSync(process.execPath, postjectArgs, { stdio: "inherit", cwd: pkgDir });

  if (isMac) {
    try {
      execFileSync("codesign", ["--sign", "-", outBin], { stdio: "inherit" });
    } catch (err) {
      console.warn(`[build-sea] warning: ad-hoc codesign failed (continuing, binary still runs locally): ${err.message}`);
    }
  }
  if (isWin) {
    // Windows signing (signtool) is optional and requires a cert most dev
    // machines don't have; skip silently — an unsigned .exe still runs
    // locally (may trigger a SmartScreen prompt for downloaded copies,
    // not relevant to a locally-built binary).
  }

  console.log(`[build-sea] built ${outBin}`);
}

async function main() {
  await bundle();
  if (process.argv.includes("--bundle-only")) return;
  assembleSea();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
