import { readFileSync, existsSync } from "node:fs";

import { writeFileAtomic } from "./atomic.js";
import { tombstonePath } from "./paths.js";

/** How long to wait after the last mutation before persisting to disk. */
const FLUSH_DEBOUNCE_MS = 200;

/**
 * Durable set of `${projectId}/${filename}` keys the agent has explicitly
 * deleted locally (or been told the Hub deleted). Persisted so a delete
 * "intent" survives a restart even if the job that was supposed to
 * propagate it to the Hub got abandoned mid-flight (audit #5).
 */
export interface TombstoneStore {
  has(key: string): boolean;
  add(key: string): void;
  delete(key: string): void;
  list(): string[];
  /** Synchronously persist any pending changes right now. */
  flush(): void;
  /** Flush pending changes and clear any pending debounce timer. */
  close(): void;
}

function loadSet(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    // Valid JSON but the wrong shape (null, a number, a string, an object,
    // an array containing non-strings, ...) must also start clean —
    // otherwise later reads/writes could crash or behave unpredictably.
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    // Corrupt tombstone file — start clean rather than crash-looping the agent.
    return new Set();
  }
}

/**
 * Persisted store of tombstone keys, JSON-array-encoded at `path`,
 * atomically, with writes batched/debounced rather than a synchronous
 * rewrite on every mutation. Mirrors `state.ts`'s persistence pattern.
 */
export function createTombstones(path: string = tombstonePath()): TombstoneStore {
  const set = loadSet(path);
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function doFlush(): void {
    if (!dirty) return;
    writeFileAtomic(path, JSON.stringify([...set]));
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
    has(key) {
      return set.has(key);
    },
    add(key) {
      set.add(key);
      scheduleFlush();
    },
    delete(key) {
      set.delete(key);
      scheduleFlush();
    },
    list() {
      return [...set];
    },
    flush,
    close() {
      flush();
    },
  };
}
