import { readFileSync, existsSync } from "node:fs";

import { writeFileAtomic } from "./atomic.js";
import { statePath } from "./paths.js";

/** How long to wait after the last mutation before persisting to disk. */
const FLUSH_DEBOUNCE_MS = 200;

export interface AgentState {
  get(projectId: number, filename: string): string | null;
  set(projectId: number, filename: string, hash: string): void;
  del(projectId: number, filename: string): void;
  /** Synchronously persist any pending changes right now. */
  flush(): void;
  /** Flush pending changes and clear any pending debounce timer. */
  close(): void;
}

function loadMap(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    // Corrupt state file — start clean rather than crash-looping the agent.
    return {};
  }
}

const key = (projectId: number, filename: string): string => `${projectId}/${filename}`;

/**
 * Per-file base-hash store, keyed by `${projectId}/${filename}`, used to
 * send base_hash on push for conflict detection. Persisted to JSON at
 * `path`, atomically, with writes batched/debounced rather than a
 * synchronous rewrite on every mutation.
 */
export function createState(path: string = statePath()): AgentState {
  const map: Record<string, string> = loadMap(path);
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function doFlush(): void {
    if (!dirty) return;
    writeFileAtomic(path, JSON.stringify(map));
    dirty = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleFlush(): void {
    dirty = true;
    if (timer !== null) return; // already scheduled — one pending timer at a time
    timer = setTimeout(doFlush, FLUSH_DEBOUNCE_MS);
    timer.unref?.();
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    doFlush();
  }

  return {
    get(projectId, filename) {
      return map[key(projectId, filename)] ?? null;
    },
    set(projectId, filename, hash) {
      map[key(projectId, filename)] = hash;
      scheduleFlush();
    },
    del(projectId, filename) {
      delete map[key(projectId, filename)];
      scheduleFlush();
    },
    flush,
    close() {
      flush();
    },
  };
}
