#!/usr/bin/env node
import os from "node:os";
import { fileURLToPath } from "node:url";

import { pairRedeem } from "./api.js";
import { runAgent as runAgentImpl } from "./agent.js";
import { loadConfig as loadConfigImpl, saveConfig as saveConfigImpl } from "./config.js";
import { configPath } from "./paths.js";
import { VERSION } from "./version.js";

export interface CliDeps {
  pairRedeem: typeof import("./api.js").pairRedeem;
  saveConfig: typeof import("./config.js").saveConfig;
  loadConfig: typeof import("./config.js").loadConfig;
  runAgent: typeof import("./agent.js").runAgent;
  log: (msg: string) => void;
}

const USAGE = [
  "SyncHub Agent",
  "",
  "Usage:",
  "  synchub-agent pair <CODE> <hubUrl> [--label <name>]   Register this machine",
  "  synchub-agent run                                     Start syncing",
  "  synchub-agent status                                  Show pairing status",
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

/** Print whether this machine is currently paired with a Hub. */
export function cmdStatus(deps: Pick<CliDeps, "loadConfig" | "log">): number {
  const cfg = deps.loadConfig();
  if (cfg) {
    deps.log(`Paired to ${cfg.hubUrl} as machine #${cfg.machineId}`);
  } else {
    deps.log("Not paired — run: synchub-agent pair <CODE> <HUB_URL>");
  }
  return 0;
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
 * Deliberately does NOT block on a never-resolving promise to stay alive —
 * the agent's own live handles (the open WS socket, the chokidar watchers)
 * are real OS handles that keep Node's event loop alive on their own, so
 * resolving here (once boot is wired up) is enough. SIGINT/SIGTERM call
 * `handle.stop()` (closing those handles) and then exit explicitly.
 */
export async function cmdRun(deps: Pick<CliDeps, "loadConfig" | "log" | "runAgent">): Promise<number> {
  const cfg = deps.loadConfig();
  if (!cfg) {
    deps.log(`Not paired — run: synchub-agent pair <CODE> <HUB_URL> (config expected at ${configPath()})`);
    return 1;
  }

  const handle = deps.runAgent(cfg, { log: deps.log });

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    deps.log("shutting down...");
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

const defaultDeps: CliDeps = {
  pairRedeem,
  saveConfig: saveConfigImpl,
  loadConfig: loadConfigImpl,
  runAgent: runAgentImpl,
  log: (msg: string) => console.log(msg),
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
    case "--version":
    case "-v":
      return cmdVersion(deps);
    default:
      deps.log(USAGE);
      return cmd === undefined ? 0 : 1;
  }
}

// Only run when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).then((code) => {
    if (code) process.exitCode = code;
  });
}
