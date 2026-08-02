import { describe, expect, it, afterEach } from "vitest";
import { build } from "esbuild";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Guards the SEA single-binary build (scripts/build-sea.mjs): esbuild must
// be able to bundle src/cli.ts into one self-contained CJS file with every
// *local* module inlined. If a future dependency (or a new local module
// esbuild can't statically resolve) breaks that, this fails here instead of
// silently producing a binary that crashes on the target machine with a
// missing-module error.
const outDir = join(tmpdir(), "synchub-agent-bundle-test");
const outfile = join(outDir, "bundle.cjs");

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("cli bundle (SEA build guard)", () => {
  it("bundles src/cli.ts into a single self-contained CJS file", async () => {
    await build({
      entryPoints: ["src/cli.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile,
      external: ["node-notifier"],
      define: { "process.env.SYNCHUB_VERSION": JSON.stringify("0.0.0-test") },
      logLevel: "silent",
    });

    const stats = statSync(outfile);
    expect(stats.isFile()).toBe(true);
    // A real bundle of this CLI is a few hundred KB; anything near-empty
    // means bundling silently produced a stub instead of the real thing.
    expect(stats.size).toBeGreaterThan(50_000);

    const contents = readFileSync(outfile, "utf8");
    // Every local (relative-path) import must have been inlined by esbuild.
    // A surviving `require("./..." )`/`require("../...")` means some local
    // module fell through to runtime resolution — which won't exist next to
    // the bundle inside a SEA binary.
    const unresolvedLocalRequires = [...contents.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)].map((m) => m[1]);
    expect(unresolvedLocalRequires).toEqual([]);

    // node-notifier is intentionally kept external (see scripts/build-sea.mjs);
    // confirm it's still resolved at runtime (lazy `import()`, per
    // notifier.ts) rather than accidentally inlined — its vendored platform
    // binaries can't be bundled into one file.
    expect(contents).toMatch(/import\(["']node-notifier["']\)/);
  });
});
