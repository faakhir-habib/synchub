import { join } from "node:path";
import { homedir } from "node:os";

/** Path to the agent's config file. Read at call time so tests can override via env. */
export function configPath(): string {
  return process.env.SYNCHUB_CONFIG ?? join(homedir(), ".synchub", "config.json");
}

/** Path to the agent's state file. Read at call time so tests can override via env. */
export function statePath(): string {
  return process.env.SYNCHUB_STATE ?? join(homedir(), ".synchub", "state.json");
}

/** Path to the agent's tombstone store. Read at call time so tests can override via env. */
export function tombstonePath(): string {
  return process.env.SYNCHUB_TOMBSTONES ?? join(homedir(), ".synchub", "tombstones.json");
}
