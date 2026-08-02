import {
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * Write `data` to `filePath` atomically: write to a sibling `.tmp` file,
 * fsync it, then rename over the destination. Never leaves a partially
 * written file at `filePath`, and cleans up the `.tmp` file on any error.
 */
export function writeFileAtomic(filePath: string, data: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(tmp, filePath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }

  // Best-effort: fsync the parent directory so the rename is durable.
  // Not supported on Windows — swallow any failure.
  try {
    const dirFd = openSync(dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // ignore — directory fsync isn't available on all platforms
  }
}
