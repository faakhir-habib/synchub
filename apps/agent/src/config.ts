import { readFileSync, existsSync, chmodSync } from "node:fs";

import { writeFileAtomic } from "./atomic.js";
import { configPath } from "./paths.js";

export interface AgentConfig {
  hubUrl: string;
  machineToken: string;
  machineId: number;
  notifications?: boolean;
}

/**
 * Load the agent config. Returns null if the file is missing OR corrupt —
 * a malformed config must never crash the agent (crash-loop fix).
 */
export function loadConfig(path = configPath()): AgentConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentConfig;
  } catch {
    return null;
  }
}

/**
 * Save the agent config atomically and lock down its permissions
 * (it holds the machine token).
 */
export function saveConfig(cfg: AgentConfig, path = configPath()): void {
  writeFileAtomic(path, JSON.stringify(cfg, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort — not meaningful on Windows
  }
}
