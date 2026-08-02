# Phase 4c — Agent Distribution & Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new TypeScript agent (`apps/agent`) trivially installable — a single self-contained binary per OS, one-line install scripts, real OS-service registration via `install`/`uninstall`/`status` subcommands — then delete the legacy `agent/` and finalize docs.

**Architecture:** esbuild bundles `src/cli.ts` into one CJS file; Node 22+ **SEA** (Single Executable Applications) injects that bundle into a copy of the `node` binary → `synchub-agent[.exe]`, no Node/npm needed on the target. The binary self-registers as an OS service (systemd / launchd / Windows) pointing at a **user-independent config path** baked into the unit. Install scripts download the right binary, pair, and register the service. CI builds all three binaries on tag and attaches them to a GitHub Release.

**Tech Stack:** Node 22+ SEA + `postject`, esbuild, POSIX sh + PowerShell install scripts, systemd/launchd/Windows service wrappers, GitHub Actions.

**Conventions (in force):** Windows PowerShell (`A; if ($?) { B }`, not `&&`); only touch `apps/agent/` (+ root `.github/` for CI, + root `README` in the final task); do NOT touch the legacy `agent/` until Task 6 deletes it; `.js` extensions on relative ESM imports in agent source; no `Math.random`/`Date.now` in runtime code; commit per task with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; keep `pnpm --filter @synchub/agent test` + `build` green. **Cross-platform note:** only Windows can be end-to-end verified on the dev machine — Linux/macOS artifacts are authored to match the documented contracts and smoke-verified in CI; each task states what is verified where.

**Reference (read, do not modify — deleted in Task 6):** legacy `agent/service/{systemd,launchd,windows}` templates and `agent/README.md`.

---

## Task 1: SEA single-binary build

**Files:**
- Create: `apps/agent/esbuild.config.mjs` (or inline in the build script)
- Create: `apps/agent/sea-config.json`
- Create: `apps/agent/scripts/build-sea.mjs`
- Modify: `apps/agent/package.json` (add `bundle` + `build:sea` scripts, add `esbuild` + `postject` devDeps)
- Create: `apps/agent/scripts/build-sea.test.mjs` OR a vitest test asserting the bundle is single-file + requires no external runtime deps (see Step 4)

- [ ] **Step 1: esbuild bundle.** Add `esbuild` (^0.24) + `postject` (^1.0.0-alpha.6) to `apps/agent` devDependencies (`pnpm --filter @synchub/agent add -D esbuild postject`). Create a bundle step that bundles `src/cli.ts` → `dist/bundle.cjs`:

```js
// apps/agent/scripts/build-sea.mjs (bundle portion)
import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",              // SEA requires CJS
  outfile: "dist/bundle.cjs",
  // node-notifier spawns vendored platform binaries at runtime that cannot be
  // bundled; keep it external so the SEA binary starts cleanly and the agent's
  // fail-safe lazy import (notifier.ts) simply disables OS notifications when
  // the module is absent. Document this in the README (Task 6).
  external: ["node-notifier"],
  banner: { js: "" },
});
```

- [ ] **Step 2: SEA config.** Create `apps/agent/sea-config.json`:

```json
{
  "main": "dist/bundle.cjs",
  "output": "dist/sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": false
}
```

- [ ] **Step 3: SEA assembly script.** In `apps/agent/scripts/build-sea.mjs`, after the esbuild bundle, generate the blob and inject it into a copy of the running `node` binary via `postject`. Make it OS-aware (produce `synchub-agent.exe` on Windows, `synchub-agent` elsewhere). Use `node:child_process` `execFileSync`, `process.execPath`, `process.platform`:

```js
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const isWin = process.platform === "win32";
const outDir = "dist/sea";
mkdirSync(outDir, { recursive: true });
const outBin = join(outDir, isWin ? "synchub-agent.exe" : "synchub-agent");

// 1. blob
execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { stdio: "inherit" });
// 2. copy node
copyFileSync(process.execPath, outBin);
// 3. (macOS/Windows) remove the signature before injecting, re-sign after — best-effort.
//    On Windows, signtool is optional; on macOS, `codesign --remove-signature` then re-sign ad-hoc.
// 4. inject the blob
const sentinel = "NODE_SEA_FUSE_fce680ab2cc2b1fa";
const args = [
  "postject", outBin, "NODE_SEA_BLOB", "dist/sea-prep.blob",
  "--sentinel-fuse", sentinel,
  ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
];
execFileSync("npx", args, { stdio: "inherit", shell: isWin });
console.log(`Built ${outBin}`);
```

Wire scripts in `package.json`: `"bundle": "node scripts/build-sea.mjs --bundle-only"` is optional; simplest — `"build:sea": "pnpm build && node scripts/build-sea.mjs"` (tsc build first so shared types resolve, then bundle+assemble). Handle the macOS/Windows re-sign as best-effort (wrap in try/catch, log a warning on failure — an ad-hoc/unsigned binary still runs locally; CI can sign properly).

- [ ] **Step 4: Verify on Windows + guard test.** Run `pnpm --filter @synchub/agent build:sea`; then run `dist/sea/synchub-agent.exe --version` and confirm it prints the version from `package.json` (proves the bundle + SEA injection + `version.ts`'s `package.json` read work inside the binary — note `version.ts` reads `../package.json` via `import.meta.url`; confirm that path resolves inside the bundle, and if not, switch `version.ts` to import the version via an esbuild `define` or a bundled constant — fix `version.ts` if the binary can't read it). Also run `dist/sea/synchub-agent.exe status` → prints "Not paired" (proves the CLI dispatch works). Add a vitest test `scripts/build-sea` is NOT required; instead add a lightweight assertion test that `esbuild` bundling of `src/cli.ts` succeeds and the output is a single file with no `require("./...")` of un-bundled local modules (build the bundle to a temp path in the test and assert it exists + is non-trivial size). Report the actual `.exe` size + that `--version`/`status` ran.

- [ ] **Step 5: Commit.** `git add apps/agent/{scripts,sea-config.json,package.json,esbuild.config.mjs} pnpm-lock.yaml` (+ `dist/` stays gitignored — confirm `.gitignore` ignores `apps/agent/dist`). Commit `feat(agent): SEA single-binary build (esbuild + postject)`.

---

## Task 2: install / uninstall / status service subcommands

**Files:**
- Create: `apps/agent/src/service.ts` (platform-aware service registration)
- Create: `apps/agent/src/service.test.ts`
- Modify: `apps/agent/src/cli.ts` (wire `install`/`uninstall` subcommands; extend `status`; update USAGE + `CliDeps`)
- Modify: `apps/agent/src/cli.test.ts`

- [ ] **Step 1: Failing test** `apps/agent/src/service.test.ts`. Design `service.ts` with an injectable `runCommand` seam (`(cmd: string, args: string[]) => { code: number; stdout: string; stderr: string }`) and an injectable `platform` + `writeFile`/`paths` so it's testable without touching the real OS. Export `installService(deps)`, `uninstallService(deps)`, `serviceStatus(deps)`. Assert (per platform, driving `deps.platform`):
  - **linux:** `installService` writes the systemd unit (to `~/.config/systemd/user/synchub-agent.service` for a user service — pick user-level to avoid sudo; document) with `ExecStart=<selfPath> run` and `Environment=SYNCHUB_CONFIG=<configPath>`, then runs `systemctl --user daemon-reload`, `enable --now synchub-agent`. `uninstallService` runs `disable --now` + removes the unit + `daemon-reload`. `serviceStatus` runs `systemctl --user is-active` and maps the output to `active|inactive|not-installed`.
  - **darwin:** writes the launchd plist to `~/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist` with `ProgramArguments=[<selfPath>, "run"]`, `RunAtLoad`+`KeepAlive` true, and `EnvironmentVariables/SYNCHUB_CONFIG`; runs `launchctl load -w <plist>` (install) / `launchctl unload -w` + rm (uninstall); status via `launchctl list | grep`.
  - **win32:** registers a startup mechanism (see Step 2 for the wrapper decision) and status reflects installed/running.
  - `selfPath` = the running binary's path (`process.execPath` when run as the SEA binary; for `node dist/cli.js` dev mode, fall back to a documented path). Confirm the unit points at the SEA binary, NOT a hardcoded `node` path (design requirement).
  Run → FAIL.

- [ ] **Step 2: Implement `service.ts`.** Platform switch. Templates as string builders (interpolating `selfPath` + `configPath()`), written via the atomic writer or plain `fs`. For **Windows**: a plain SEA `.exe` does not speak the Service Control Manager protocol, so a bare `sc.exe create` service is marked "not responding." Two supported options — implement whichever verifies cleanly on the dev machine, and document the choice:
  - (a) **Scheduled Task at startup** (robust, no extra deps): `schtasks /Create /TN SyncHubAgent /TR "\"<selfPath>\" run" /SC ONSTART /RU SYSTEM /RL HIGHEST /F` — runs in Session 0 at boot as SYSTEM (a genuine background service-like start, not a logon task). `uninstall` = `schtasks /Delete /TN SyncHubAgent /F`. `status` = `schtasks /Query /TN SyncHubAgent`.
  - (b) A real service via a bundled **WinSW** wrapper (heavier; defer unless (a) is insufficient).
  Prefer (a) — it satisfies "starts in Session 0 at boot, not a per-logon task" and is fully verifiable here. Document that a true SCM service (option b) is a follow-up. All subcommands print clear success/next-step messages and return sane exit codes; never throw (guard `runCommand` failures → readable error + non-zero exit).

- [ ] **Step 3: Wire `cli.ts`.** Add `install`/`uninstall` cases → `installService`/`uninstallService` (default deps: real `runCommand` via `execFileSync`, real `platform`, real `writeFile`). Extend `cmdStatus` to also report service state (call `serviceStatus`) alongside the existing paired/not-paired line. Update `USAGE` with the three lines. Add the new funcs to `CliDeps` (injectable) with real defaults. Keep existing cli tests green; update `cli.test.ts` to assert `install`/`uninstall` invoke the service funcs and `status` includes service state (with mocked deps — no real OS calls).

- [ ] **Step 4: Verify.** `pnpm --filter @synchub/agent test` twice. `pnpm --filter @synchub/agent build`. **On Windows, manually**: build the SEA binary (Task 1), run `synchub-agent.exe install` (elevated), confirm `schtasks /Query /TN SyncHubAgent` shows it, run `synchub-agent.exe status` shows installed, then `synchub-agent.exe uninstall` removes it. Report what was verified live vs unit-only. Commit `feat(agent): install/uninstall/status service subcommands`.

---

## Task 3: OS service templates (canonical, checked-in)

**Files:**
- Create: `apps/agent/service/systemd/synchub-agent.service`
- Create: `apps/agent/service/launchd/cloud.mylogiclab.synchub-agent.plist`
- Create: `apps/agent/service/windows/README.md` (documents the Scheduled-Task approach + the manual `sc`/WinSW follow-up)
- Create: `apps/agent/service/README.md` (how the templates relate to the `install` subcommand)

These are the canonical, documented reference templates (the `install` subcommand generates equivalents at runtime; these are for users who register manually). Improve over the legacy versions:

- [ ] **Step 1:** systemd unit — `ExecStart=/opt/synchub/synchub-agent run` (the SEA binary, **no `node`**), `Environment=SYNCHUB_CONFIG=/etc/synchub/config.json` (**user-independent** path), `After=network-online.target` + `Wants=network-online.target`, `Restart=on-failure`, `RestartSec=5`, a system-level `[Install] WantedBy=multi-user.target` variant documented alongside the user-level one. Include a header comment showing both the system (`/etc/systemd/system`, runs as a dedicated `User=synchub`) and user (`systemctl --user`) install paths.

- [ ] **Step 2:** launchd plist — `ProgramArguments=[/usr/local/bin/synchub-agent, run]` (the SEA binary, **path-agnostic** — works on Apple Silicon and Intel since it's the agent binary, not `/usr/local/bin/node`), `RunAtLoad`+`KeepAlive` true, `EnvironmentVariables → SYNCHUB_CONFIG=/usr/local/etc/synchub/config.json`, log paths under `/tmp`. Label `cloud.mylogiclab.synchub-agent`.

- [ ] **Step 3:** `service/windows/README.md` — document the `synchub-agent install` Scheduled-Task-at-startup approach as primary, and the manual `sc.exe`/WinSW route as the "true SCM service" follow-up, with exact commands.

- [ ] **Step 4:** `service/README.md` — one page: "the recommended path is `synchub-agent install` (auto-detects your OS); these files are the canonical templates it mirrors, for manual/custom setups." Commit `docs(agent): canonical OS service templates (SEA-binary, user-independent config)`.

---

## Task 4: One-line install scripts

**Files:**
- Create: `apps/agent/install/install.sh` (mac/linux)
- Create: `apps/agent/install/install.ps1` (windows)
- Create: `apps/agent/install/README.md`

- [ ] **Step 1: `install.sh`** — POSIX `sh`. Detect OS (`uname -s` → linux/darwin) + arch (`uname -m` → x64/arm64), map to the release asset name (`synchub-agent-linux-x64`, `synchub-agent-macos-arm64`, …), download the latest (or a `SYNCHUB_VERSION`-pinned) release binary from GitHub Releases via `curl -fsSL`, `chmod +x`, install to `/usr/local/bin/synchub-agent` (fall back to `$HOME/.local/bin` if not writable, warn to add to PATH). Then, if a pairing code is provided (`$1` or `SYNCHUB_CODE` + `SYNCHUB_HUB`), run `synchub-agent pair "$CODE" "$HUB"`; then prompt to run `synchub-agent install` for the service. `set -eu`; clear echos; a `--help`. Idempotent (re-running upgrades the binary).

- [ ] **Step 2: `install.ps1`** — PowerShell. Detect arch (`$env:PROCESSOR_ARCHITECTURE`), download `synchub-agent-win-x64.exe` from Releases via `Invoke-WebRequest`, place in `$env:LOCALAPPDATA\Programs\SyncHub\synchub-agent.exe`, add that dir to the user PATH if missing. Optional pair (`-Code`/`-Hub` params or `$env:SYNCHUB_CODE`), then offer `synchub-agent install`. `$ErrorActionPreference = "Stop"`; clear output; `-Help`.

- [ ] **Step 3: `install/README.md`** — the two one-liners: `curl -fsSL https://<host>/install.sh | sh` and `irm https://<host>/install.ps1 | iex`, plus env-var options (pinned version, pairing code, hub URL). Note the scripts target GitHub Releases assets produced by Task 5's CI.

- [ ] **Step 4:** Lint the shell script if `shellcheck` is available (best-effort); otherwise eyeball. No unit tests (scripts hit the network); a CI smoke test lands in Task 5. Commit `feat(agent): one-line install scripts (sh + ps1)`.

---

## Task 5: CI release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- (Verify only) the workflow references the Task 1 build script + Task 4 asset names.

- [ ] **Step 1:** A workflow triggered on `push` tags matching `v*` (and `workflow_dispatch`). A matrix over `{ os: ubuntu-latest, macos-latest, windows-latest }`. Each job: checkout, setup pnpm + Node 22, `pnpm install --frozen-lockfile`, `pnpm --filter @synchub/agent build:sea`, rename `dist/sea/synchub-agent[.exe]` → the OS/arch asset name (`synchub-agent-{linux,macos,win}-x64`; add the macOS `arm64` build via the `macos-14` runner or a note), and upload as a workflow artifact.

- [ ] **Step 2:** A final `release` job (needs the matrix) that downloads all artifacts and attaches them to a GitHub Release (`softprops/action-gh-release` or `gh release create`), using `GITHUB_TOKEN`. Include a checksums file (`sha256sum`).

- [ ] **Step 3:** A lightweight smoke step in each matrix job after the build: run `dist/sea/synchub-agent[.exe] --version` and assert it exits 0 and prints the version — so a broken SEA build fails CI, not users.

- [ ] **Step 4:** Do NOT trigger a real release. Validate YAML (`yamllint` or a parse check) and confirm job/step wiring by inspection. Commit `ci(agent): release workflow — build + publish SEA binaries per OS`.

---

## Task 6: Cutover — delete legacy, docs, final review

**Files:**
- Delete: the entire legacy `agent/` directory
- Modify: root `README.md` (agent install/run section → the new binary + scripts)
- Verify: no remaining references to the legacy `agent/` path anywhere

- [ ] **Step 1:** Grep the whole repo for references to the legacy `agent/` path (root `README`, `docker-compose`, `.dockerignore`, any scripts, `package.json` workspaces, CI). List them. Confirm `pnpm-workspace.yaml` includes `apps/*` (the new agent) and does NOT depend on the root `agent/`. If `.dockerignore` root-anchored `/agent/` — that becomes moot once deleted; leave or clean.

- [ ] **Step 2:** `git rm -r agent/` (the legacy JS agent — fully superseded by `apps/agent`). Confirm nothing in `apps/`, `packages/`, or the Docker build imports from it.

- [ ] **Step 3:** Update the root `README.md` agent section: install via the one-liner (Task 4), or download the binary from Releases; `synchub-agent pair <CODE> <HUB>`, `synchub-agent install`, `synchub-agent status`. Note the SEA binary has no bundled OS-notification backend (fail-safe/optional). Remove any legacy `agent/`-based instructions.

- [ ] **Step 4:** Full verify: `pnpm -r build`, `pnpm -r test` (report per-package), `pnpm lint`. Confirm the deleted legacy dir broke nothing. `git status` clean except intended changes. Commit `chore(agent): delete legacy JS agent; docs point at the new binary`.

- [ ] **Step 5:** Orchestrator dispatches a **whole-project final review** (all of Phases 1–4) focused on integration seams + any cross-phase drift, then proceeds to `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

- **Spec coverage (design §5/§6-4c):** SEA single binary (Task 1); install scripts sh+ps1 (Task 4); OS service templates fixed — SEA-binary ExecStart, user-independent config, network-online, path-agnostic launchd, Windows Session-0-at-startup (Tasks 2+3); install/uninstall/status subcommands (Task 2); CI release job (Task 5); delete legacy `agent/` + docs (Task 6). Auto-update is explicitly deferred per design §5 (not planned here).
- **node-notifier-in-SEA** resolved: kept external + fail-safe optional, documented (Task 1 Step 1 + Task 6 Step 3).
- **Cross-platform honesty:** each task states Windows-verified vs CI/authored-only. Linux/macOS service + binaries are smoke-tested in CI (Task 5 Step 3), not on the dev machine.
- **No placeholders:** each step has concrete files, commands, and config. Build-tool exploratory details (postject flags, signing) are bounded with documented fallbacks.
- **Type/name consistency:** `synchub-agent` binary name, `SYNCHUB_CONFIG` env, `cloud.mylogiclab.synchub-agent` launchd label, `SyncHubAgent` task name used consistently across tasks.
