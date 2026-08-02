import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Tracks the last-known canonical hash per (projectId, filename) so the agent
// can send base_hash on push (for conflict detection). Persisted to JSON.
export function createState(path) {
  let map = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const key = (pid, fn) => `${pid}/${fn}`;
  function save() {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2));
  }
  return {
    get: (pid, fn) => map[key(pid, fn)] ?? null,
    set: (pid, fn, h) => { map[key(pid, fn)] = h; save(); },
    del: (pid, fn) => { delete map[key(pid, fn)]; save(); },
  };
}
