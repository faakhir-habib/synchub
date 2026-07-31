import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function defaultConfigPath() {
  return process.env.SYNCHUB_CONFIG || join(homedir(), ".synchub", "config.json");
}

export function loadConfig(path = defaultConfigPath()) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

// Config holds the machine token — write it with restrictive perms.
export function saveConfig(cfg, path = defaultConfigPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  try { chmodSync(path, 0o600); } catch {}
  return path;
}
