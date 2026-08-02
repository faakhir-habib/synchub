#!/usr/bin/env node
import os from "node:os";
import { fileURLToPath } from "node:url";

import { pairRedeem } from "./api.js";
import { runAgent as runAgentImpl } from "./agent.js";
import { loadConfig as loadConfigImpl, saveConfig as saveConfigImpl } from "./config.js";
import { configPath } from "./paths.js";
import {
  defaultServiceDeps,
  installService as installServiceImpl,
  serviceStatus as serviceStatusImpl,
  uninstallService as uninstallServiceImpl,
} from "./service.js";
import type { ServiceStatus } from "./service.js";
import { VERSION } from "./version.js";

export interface CliDeps {
  pairRedeem: typeof import("./api.js").pairRedeem;
  saveConfig: typeof import("./config.js").saveConfig;
  loadConfig: typeof import("./config.js").loadConfig;
  runAgent: typeof import("./agent.js").runAgent;
  installService: () => number;
  uninstallService: () => number;
  serviceStatus: () => ServiceStatus;
  log: (msg: string) => void;
}

const USAGE = [
  "SyncHub Agent",
  "",
  "Usage:",
  "  synchub-agent pair <CODE> <hubUrl> [--label <name>]   Register this machine",
  "  synchub-agent run                                     Start syncing",
  "  synchub-agent status                                  Show pairing status",
  "  synchub-agent install                                 Register as an OS service (start on boot)",
  "  synchub-agent uninstall                               Remove the OS service",
  "  synchub-agent --version                               Print the agent version",
].join("\n");

/** Register this machine with the Hub using a pairing code. */
export async function cmdPair(args: string[], deps: CliDeps): Promise<number> {
  const positional: string[] = [];
  let label: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--label") {
      label = args[i + 1];
      i += 1;
    } else {
      positional.push(args[i]);
    }
  }

  const code = positional[0];
  const rawHubUrl = positional[1] ?? process.env.SYNCHUB_HUB;
  const hubUrl = rawHubUrl?.replace(/\/$/, "");

  if (!code || !hubUrl) {
    deps.log("usage: synchub-agent pair <CODE> <hubUrl> [--label <name>]");
    return 1;
  }

  const info = {
    name: os.hostname(),
    os: process.platform,
    os_version: os.release(),
    agent_version: VERSION,
    ...(label ? { label } : {}),
  };

  const result = await deps.pairRedeem(hubUrl, code, info);
  if (!result.ok) {
    const detail = result.status !== undefined ? `${result.kind} (status ${result.status})` : result.kind;
    deps.log(`Pair failed: ${detail}`);
    return 1;
  }

  deps.saveConfig({ hubUrl, machineToken: result.data.machineToken, machineId: result.data.machineId });
  deps.log(`Paired — config saved to ${configPath()}`);
  return 0;
}

/** Print whether this machine is currently paired with a Hub, and OS service state. */
export function cmdStatus(deps: Pick<CliDeps, "loadConfig" | "log" | "serviceStatus">): number {
  const cfg = deps.loadConfig();
  if (cfg) {
    deps.log(`Paired to ${cfg.hubUrl} as machine #${cfg.machineId}`);
  } else {
    deps.log("Not paired — run: synchub-agent pair <CODE> <HUB_URL>");
  }

  const svc = deps.serviceStatus();
  deps.log(svc.installed ? `Service: installed, ${svc.running ? "running" : "not running"}` : "Service: not installed");

  return 0;
}

/** Register this agent as an OS background service (systemd/launchd/Scheduled Task). */
export function cmdInstall(deps: Pick<CliDeps, "installService">): number {
  return deps.installService();
}

/** Stop and remove the OS background service registered by `install`. */
export function cmdUninstall(deps: Pick<CliDeps, "uninstallService">): number {
  return deps.uninstallService();
}

/** Print the agent version (sourced from package.json, never hardcoded). */
export function cmdVersion(deps: Pick<CliDeps, "log">): number {
  deps.log(VERSION);
  return 0;
}

/**
 * Start the sync engine: boot the agent (reconcile, watch, connect WS) and
 * keep running until SIGINT/SIGTERM. Returns 1 immediately if unpaired.
 *
 * Installs its own ref'd keepalive interval rather than relying on
 * runAgent's internal handles (the WS socket, chokidar watchers, the 30s
 * tick) to keep the event loop alive: those are all deliberately unref'd
 * (so unit tests can finish without waiting on them), and there may be
 * ZERO of them at all — e.g. a paired-but-revoked-token agent has no auto
 * mappings, so no watchers are started, and once the WS's first connection
 * attempt closes there's nothing ref'd left. Without a daemon-level
 * keepalive, Node's event loop would drain and the process would exit
 * silently right after logging "Agent running", even though nothing
 * actually failed loudly — hiding the "re-pair this machine" guidance
 * that should otherwise keep appearing on every reconcile tick. SIGINT/
 * SIGTERM still call `handle.stop()`, clear the keepalive, and exit
 * explicitly.
 */
export async function cmdRun(deps: Pick<CliDeps, "loadConfig" | "log" | "runAgent">): Promise<number> {
  const cfg = deps.loadConfig();
  if (!cfg) {
    deps.log(`Not paired — run: synchub-agent pair <CODE> <HUB_URL> (config expected at ${configPath()})`);
    return 1;
  }

  const handle = deps.runAgent(cfg, { log: deps.log });

  // ~12 days — effectively "forever" for a no-op interval. Intentionally
  // NOT unref()'d: this is the one handle whose entire job is to keep the
  // process alive regardless of what runAgent's own (unref'd) handles are
  // doing.
  const keepAlive = setInterval(() => {}, 1 << 30);

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    deps.log("shutting down...");
    clearInterval(keepAlive);
    handle
      .stop()
      .catch((err: unknown) => deps.log(`error during shutdown: ${String(err)}`))
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  deps.log("Agent running — Ctrl-C to stop");
  return 0;
}

const defaultLog = (msg: string): void => console.log(msg);

const defaultDeps: CliDeps = {
  pairRedeem,
  saveConfig: saveConfigImpl,
  loadConfig: loadConfigImpl,
  runAgent: runAgentImpl,
  installService: () => installServiceImpl(defaultServiceDeps(defaultLog)),
  uninstallService: () => uninstallServiceImpl(defaultServiceDeps(defaultLog)),
  serviceStatus: () => serviceStatusImpl(defaultServiceDeps(defaultLog)),
  log: defaultLog,
};

export async function main(argv: string[], deps: CliDeps = defaultDeps): Promise<number> {
  const [cmd, ...rest] = argv.slice(2);

  switch (cmd) {
    case "pair":
      return cmdPair(rest, deps);
    case "run":
      return cmdRun(deps);
    case "status":
      return cmdStatus(deps);
    case "install":
      return cmdInstall(deps);
    case "uninstall":
      return cmdUninstall(deps);
    case "--version":
    case "-v":
      return cmdVersion(deps);
    default:
      deps.log(USAGE);
      return cmd === undefined ? 0 : 1;
  }
}

// Only run when executed directly (not when imported by tests).
//
// `import.meta.url` is how this is detected in normal ESM (dev via tsx, or
// `node dist/cli.js`) — compare it against `process.argv[1]`, the invoked
// script path. But esbuild's CJS output (used for the bundled/SEA build,
// see scripts/build-sea.mjs) always empties `import.meta` (it's not
// representable in CJS), and inside a Node SEA binary there is no script
// file at all — `process.argv[1]` is the first *CLI argument*, not a path.
// In both of those bundled contexts `import.meta.url` is `undefined`, and
// the bundle is never anything other than the entry point (nothing
// `require`s it as a library), so treat "no import.meta.url" itself as
// "this is the entry point".
const importMetaUrl: string | undefined = (import.meta as { url?: string }).url;
const isEntryPoint =
  importMetaUrl === undefined ||
  (process.argv[1] !== undefined && fileURLToPath(importMetaUrl) === process.argv[1]);
if (isEntryPoint) {
  main(process.argv).then((code) => {
    if (code) process.exitCode = code;
  });
}
