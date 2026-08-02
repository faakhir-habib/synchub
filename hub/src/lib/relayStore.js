import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// A filename is a Claude session transcript name (UUID + .jsonl). We only ever
// store flat files keyed by (userId, projectId, filename) — reject anything
// that could escape the store directory.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function isSafeFilename(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 && SAFE_NAME.test(name);
}

// Flat-file relay store: <baseDir>/<userId>/<projectId>/<filename>
export function createRelayStore(baseDir) {
  function dirFor(userId, projectId) {
    return join(baseDir, String(userId), String(projectId));
  }
  function pathFor(userId, projectId, filename) {
    if (!isSafeFilename(filename)) throw new Error("unsafe filename");
    return join(dirFor(userId, projectId), filename);
  }
  return {
    baseDir,
    write(userId, projectId, filename, content) {
      const dir = dirFor(userId, projectId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(pathFor(userId, projectId, filename), content, "utf8");
    },
    read(userId, projectId, filename) {
      const p = pathFor(userId, projectId, filename);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    },
    exists(userId, projectId, filename) {
      return existsSync(pathFor(userId, projectId, filename));
    },
    remove(userId, projectId, filename) {
      const p = pathFor(userId, projectId, filename);
      if (existsSync(p)) rmSync(p);
    },
  };
}
