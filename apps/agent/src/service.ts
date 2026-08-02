import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { homedir } from "node:os";

import { configPath } from "./paths.js";

const SYSTEMD_UNIT_NAME = "synchub-agent";
const LAUNCHD_LABEL = "cloud.mylogiclab.synchub-agent";
const WIN_TASK_NAME = "SyncHubAgent";

export interface ServiceDeps {
  platform: NodeJS.Platform;
  selfPath: string;
  configPath: string;
  /**
   * Whether this process is the packaged SEA binary (vs. `node dist/cli.js`
   * or `tsx src/cli.ts` in dev). `install` refuses to register a service
   * unless this is true — see installService() for why.
   */
  isPackagedBinary: boolean;
  runCommand: (cmd: string, args: string[]) => { code: number; stdout: string; stderr: string };
  writeFile: (path: string, content: string) => void;
  removeFile: (path: string) => void;
  readFileExists: (path: string) => boolean;
  homedir: string;
  log: (m: string) => void;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  detail: string;
}

function systemdUnitPath(deps: Pick<ServiceDeps, "homedir">): string {
  return `${deps.homedir}/.config/systemd/user/${SYSTEMD_UNIT_NAME}.service`;
}

function launchdPlistPath(deps: Pick<ServiceDeps, "homedir">): string {
  return `${deps.homedir}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
}

function systemdUnitContent(deps: Pick<ServiceDeps, "selfPath" | "configPath">): string {
  return [
    "[Unit]",
    "Description=SyncHub Agent",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${deps.selfPath} run`,
    `Environment=SYNCHUB_CONFIG=${deps.configPath}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function launchdPlistContent(deps: Pick<ServiceDeps, "selfPath" | "configPath">): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
    '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${deps.selfPath}</string>`,
    "    <string>run</string>",
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>SYNCHUB_CONFIG</key>",
    `    <string>${deps.configPath}</string>`,
    "  </dict>",
    "  <key>StandardOutPath</key>",
    "  <string>/tmp/synchub-agent.log</string>",
    "  <key>StandardErrorPath</key>",
    "  <string>/tmp/synchub-agent.err</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/** Register this agent as an OS background service that starts at boot/login. */
export function installService(deps: ServiceDeps): number {
  // `deps.selfPath` (baked into the unit/plist/task as the command to run)
  // is only meaningful when this process IS the packaged synchub-agent
  // binary. Under `node dist/cli.js` or `tsx src/cli.ts` (dev), selfPath is
  // the node/tsx executable itself, so the registered service would try to
  // run "node run" / "tsx run" at boot — silently broken. Refuse instead of
  // registering something that can never work.
  if (!deps.isPackagedBinary) {
    deps.log(
      "install requires the packaged synchub-agent binary. Build it with: pnpm --filter @synchub/agent build:sea, then run <binary> install.",
    );
    return 1;
  }

  switch (deps.platform) {
    case "linux":
      return installLinux(deps);
    case "darwin":
      return installDarwin(deps);
    case "win32":
      return installWindows(deps);
    default:
      deps.log(`Service install is not supported on platform "${deps.platform}".`);
      return 1;
  }
}

/** Stop and remove the OS service registered by installService. */
export function uninstallService(deps: ServiceDeps): number {
  switch (deps.platform) {
    case "linux":
      return uninstallLinux(deps);
    case "darwin":
      return uninstallDarwin(deps);
    case "win32":
      return uninstallWindows(deps);
    default:
      deps.log(`Service uninstall is not supported on platform "${deps.platform}".`);
      return 1;
  }
}

/** Report whether the OS service is installed and, if so, whether it's running. */
export function serviceStatus(deps: ServiceDeps): ServiceStatus {
  switch (deps.platform) {
    case "linux":
      return statusLinux(deps);
    case "darwin":
      return statusDarwin(deps);
    case "win32":
      return statusWindows(deps);
    default:
      return { installed: false, running: false, detail: `unsupported platform "${deps.platform}"` };
  }
}

// --- linux (systemd --user) -------------------------------------------------

function installLinux(deps: ServiceDeps): number {
  const unitPath = systemdUnitPath(deps);
  try {
    deps.writeFile(unitPath, systemdUnitContent(deps));
  } catch (err) {
    deps.log(`Failed to write systemd unit at ${unitPath}: ${String(err)}`);
    return 1;
  }

  const reload = deps.runCommand("systemctl", ["--user", "daemon-reload"]);
  if (reload.code !== 0) {
    deps.log(`Failed to reload systemd user daemon: ${reload.stderr || reload.stdout}`);
    return reload.code || 1;
  }

  const enable = deps.runCommand("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]);
  if (enable.code !== 0) {
    deps.log(`Failed to enable synchub-agent service: ${enable.stderr || enable.stdout}`);
    return enable.code || 1;
  }

  deps.log(`Enabled. Check: systemctl --user status ${SYSTEMD_UNIT_NAME}`);
  return 0;
}

function uninstallLinux(deps: ServiceDeps): number {
  if (!deps.readFileExists(systemdUnitPath(deps))) {
    deps.log("Service not installed — nothing to remove.");
    return 0;
  }

  const disable = deps.runCommand("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]);
  if (disable.code !== 0) {
    deps.log(`Failed to disable synchub-agent service: ${disable.stderr || disable.stdout}`);
    return disable.code || 1;
  }

  try {
    deps.removeFile(systemdUnitPath(deps));
  } catch (err) {
    deps.log(`Failed to remove systemd unit: ${String(err)}`);
    return 1;
  }

  const reload = deps.runCommand("systemctl", ["--user", "daemon-reload"]);
  if (reload.code !== 0) {
    deps.log(`Failed to reload systemd user daemon: ${reload.stderr || reload.stdout}`);
    return reload.code || 1;
  }

  deps.log("Removed. synchub-agent service is no longer registered.");
  return 0;
}

function statusLinux(deps: ServiceDeps): ServiceStatus {
  const installed = deps.readFileExists(systemdUnitPath(deps));
  if (!installed) {
    return { installed: false, running: false, detail: "not installed" };
  }

  const result = deps.runCommand("systemctl", ["--user", "is-active", SYSTEMD_UNIT_NAME]);
  const state = result.stdout.trim();
  const running = state === "active";
  return { installed: true, running, detail: state || "unknown" };
}

// --- darwin (launchd) --------------------------------------------------------

function installDarwin(deps: ServiceDeps): number {
  const plistPath = launchdPlistPath(deps);
  try {
    deps.writeFile(plistPath, launchdPlistContent(deps));
  } catch (err) {
    deps.log(`Failed to write launchd plist at ${plistPath}: ${String(err)}`);
    return 1;
  }

  const load = deps.runCommand("launchctl", ["load", "-w", plistPath]);
  if (load.code !== 0) {
    deps.log(`Failed to load synchub-agent launchd service: ${load.stderr || load.stdout}`);
    return load.code || 1;
  }

  deps.log(`Loaded. Check: launchctl list | grep ${LAUNCHD_LABEL}`);
  return 0;
}

function uninstallDarwin(deps: ServiceDeps): number {
  const plistPath = launchdPlistPath(deps);
  if (!deps.readFileExists(plistPath)) {
    deps.log("Service not installed — nothing to remove.");
    return 0;
  }

  const unload = deps.runCommand("launchctl", ["unload", "-w", plistPath]);
  if (unload.code !== 0) {
    deps.log(`Failed to unload synchub-agent launchd service: ${unload.stderr || unload.stdout}`);
    return unload.code || 1;
  }

  try {
    deps.removeFile(plistPath);
  } catch (err) {
    deps.log(`Failed to remove launchd plist: ${String(err)}`);
    return 1;
  }

  deps.log("Unloaded. synchub-agent service is no longer registered.");
  return 0;
}

function statusDarwin(deps: ServiceDeps): ServiceStatus {
  const installed = deps.readFileExists(launchdPlistPath(deps));
  if (!installed) {
    return { installed: false, running: false, detail: "not installed" };
  }

  const result = deps.runCommand("launchctl", ["list"]);
  const running = result.stdout.includes(LAUNCHD_LABEL);
  return { installed: true, running, detail: running ? "running" : "loaded (not running)" };
}

// --- win32 (Scheduled Task at startup, as SYSTEM) ----------------------------

/**
 * Build the `/TR` ("Task To Run") value for `schtasks /Create`.
 *
 * The SEA binary runs at boot as SYSTEM via a Scheduled Task, which has no
 * inherited environment from the paired user session — so `configPath()`
 * (which reads `process.env.SYNCHUB_CONFIG`) would fall back to SYSTEM's own
 * profile and never find the user's paired config. Bake the install-time
 * absolute config path into the task itself by wrapping the real command in
 * `cmd /c set "VAR=value" && "<exe>" run`.
 *
 * This whole string is passed as a SINGLE argv element (via execFileSync,
 * i.e. no shell) to `/TR`. That matters for two reasons:
 *   1. schtasks stores everything after `/TR` up to the next recognized
 *      switch as one opaque command string — passing it as one argv element
 *      guarantees schtasks can't misinterpret the `&&`/spaces inside it as
 *      additional /Create switches.
 *   2. At trigger time Task Scheduler resolves the first token of the stored
 *      string as the executable (here: `cmd`, found via PATH) and passes the
 *      rest verbatim as its argument string, so cmd.exe itself parses the
 *      `set "..." && "..." run` — exactly the shell semantics we want.
 *
 * `set "VAR=value"` (quotes wrapping the whole `VAR=value`, not just value)
 * is the standard cmd.exe idiom for setting an env var to a value containing
 * spaces without the quotes ending up IN the value.
 */
function windowsTaskRunCommand(deps: Pick<ServiceDeps, "selfPath" | "configPath">): string {
  return `cmd /c set "SYNCHUB_CONFIG=${deps.configPath}" && "${deps.selfPath}" run`;
}

function installWindows(deps: ServiceDeps): number {
  const result = deps.runCommand("schtasks", [
    "/Create",
    "/TN",
    WIN_TASK_NAME,
    "/TR",
    windowsTaskRunCommand(deps),
    "/SC",
    "ONSTART",
    "/RU",
    "SYSTEM",
    "/RL",
    "HIGHEST",
    "/F",
  ]);

  if (result.code !== 0) {
    const detail = result.stderr || result.stdout;
    deps.log(`Failed to create scheduled task: ${detail}`);
    deps.log("Access denied? Run this from an elevated (Administrator) PowerShell.");
    return result.code || 1;
  }

  deps.log(`Registered. Check: schtasks /Query /TN ${WIN_TASK_NAME}`);
  return 0;
}

/** True if the Scheduled Task is currently registered. Exit-code based — see statusWindows(). */
function windowsTaskInstalled(deps: Pick<ServiceDeps, "runCommand">): boolean {
  return deps.runCommand("schtasks", ["/Query", "/TN", WIN_TASK_NAME]).code === 0;
}

function isAccessDenied(detail: string): boolean {
  return /denied/i.test(detail);
}

function uninstallWindows(deps: ServiceDeps): number {
  if (!windowsTaskInstalled(deps)) {
    deps.log("Service not installed — nothing to remove.");
    return 0;
  }

  const result = deps.runCommand("schtasks", ["/Delete", "/TN", WIN_TASK_NAME, "/F"]);

  if (result.code !== 0) {
    const detail = result.stderr || result.stdout;
    deps.log(`Failed to delete scheduled task: ${detail}`);
    if (isAccessDenied(detail)) {
      deps.log("Access denied? Run this from an elevated (Administrator) PowerShell.");
    }
    return result.code || 1;
  }

  deps.log("Removed. synchub-agent scheduled task is no longer registered.");
  return 0;
}

function statusWindows(deps: ServiceDeps): ServiceStatus {
  const result = deps.runCommand("schtasks", ["/Query", "/TN", WIN_TASK_NAME]);
  // `installed` is derived purely from the /Query exit code (0 = task
  // exists), not from parsing stdout — schtasks localizes its text output
  // (column headers, status words) to the OS display language, so string
  // matching would silently misreport `installed` on non-English Windows.
  if (result.code !== 0) {
    return { installed: false, running: false, detail: "not installed" };
  }

  // `running` is best-effort only: schtasks' "Status" column text (e.g.
  // "Running"/"Ready" in English) is localized, so this substring match can
  // under/over-report on non-English Windows. A fully robust, locale-
  // independent read would shell out to PowerShell's Get-ScheduledTaskInfo,
  // which returns a non-localized numeric/enum `State` — deliberately not
  // adding that dependency here; follow-up if this ever needs to be exact.
  const running = /running/i.test(result.stdout);
  const detail = running ? "running" : /ready/i.test(result.stdout) ? "ready" : "installed";
  return { installed: true, running, detail };
}

// --- real defaults for the CLI ----------------------------------------------

function realRunCommand(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    // Explicit stdio so BOTH streams are captured rather than inherited —
    // execFileSync's default stdio pipes stdout but, without an explicit
    // 'pipe' for fd 2, leaks the child's stderr straight through to this
    // process's real stderr (observed with `schtasks` failures printing
    // raw "ERROR: ..." text ahead of our own log lines). Capturing both
    // means callers always get readable detail via e.stdout/e.stderr and
    // nothing bypasses `deps.log`.
    const stdout = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

function realWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function realRemoveFile(path: string): void {
  rmSync(path, { force: true });
}

/**
 * True when this process is running as the packaged synchub-agent SEA
 * binary (built by scripts/build-sea.mjs), as opposed to `node dist/cli.js`
 * or `tsx src/cli.ts` in dev.
 *
 * Uses Node's `node:sea` `isSea()`, which is only available on Node 22+. A
 * static `import { isSea } from "node:sea"` would throw at module-load time
 * on an older Node (crashing the whole CLI, not just `install`), so this
 * resolves it dynamically via createRequire — which works identically
 * whether this file is running as real ESM (tsc's `dist/cli.js`, or `tsx`
 * dev) or inside the esbuild-produced CJS bundle embedded in the SEA binary
 * — and wraps the whole lookup in try/catch so an older/unusual runtime
 * that lacks `node:sea` entirely fails safe (= "not packaged") instead of
 * crashing `install`.
 *
 * esbuild empties `import.meta` when bundling to CJS (see the matching
 * comment in cli.ts), so `import.meta.url` is undefined inside the SEA
 * binary; createRequire only needs A valid base URL to resolve builtins
 * like "node:sea" (no real filesystem lookup happens), so a dummy fallback
 * is fine there.
 */
function detectIsPackagedBinary(): boolean {
  try {
    const importMetaUrl = (import.meta as { url?: string }).url;
    const req = createRequire(importMetaUrl ?? "file:///synchub-agent/dummy.js");
    const sea = req("node:sea") as { isSea: () => boolean };
    return sea.isSea();
  } catch {
    return false;
  }
}

/** Real (non-test) deps for the CLI: hits the actual OS. */
export function defaultServiceDeps(log: (m: string) => void): ServiceDeps {
  return {
    platform: process.platform,
    selfPath: process.execPath,
    configPath: configPath(),
    isPackagedBinary: detectIsPackagedBinary(),
    runCommand: realRunCommand,
    writeFile: realWriteFile,
    removeFile: realRemoveFile,
    readFileExists: (path: string) => existsSync(path),
    homedir: homedir(),
    log,
  };
}
