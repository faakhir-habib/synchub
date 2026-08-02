// Watches each AUTO-mode mapped folder for *.jsonl changes and enqueues
// push/delete work onto the SyncQueue (debounced). Ports legacy
// `agent/src/watcher.js` with fixes from the agent audit:
//   - incremental/faster live push (audit #7): legacy used chokidar's
//     awaitWriteFinish({stabilityThreshold: 500, ...}) on TOP OF its own
//     1500ms debounce, so a live-appending transcript could stall ~2s
//     before syncing. Here we drop awaitWriteFinish entirely and rely
//     solely on a short internal debounce (default 300ms) per path, so
//     appends sync promptly while still coalescing bursty writes.
//   - unlink handling (audit #5/#12): a local delete enqueues a delete
//     job (via api.deleteFile) instead of being silently ignored, and
//     tombstones the file so a stale Hub manifest entry doesn't get
//     resurrected by reconcile before the Hub catches up. Pruning
//     tombstones over time is a later concern (agent Task 5+) — this
//     module only adds them.
//   - bounded debounce-timer map (audit #13): each per-path timer entry
//     is deleted from the Map as soon as it fires, so the map never grows
//     unbounded across a long-running watch session.
//   - enqueues onto the SyncQueue rather than pushing directly, so watcher
//     events never race a concurrent reconcile/WS-triggered sync for the
//     same file — the queue serializes and coalesces by key.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import chokidar from "chokidar";

import type { AgentMapping } from "@synchub/shared";

import type { Api } from "./api.js";
import { pushLocal } from "./reconcile.js";
import type { Tombstones } from "./reconcile.js";
import type { SyncQueue } from "./sync-queue.js";
import type { AgentState } from "./state.js";

/** Minimal shape needed from a watcher instance — satisfied by chokidar's FSWatcher and by test fakes. */
export interface WatchHandle {
  on(event: string, cb: (path: string) => void): unknown;
  close(): Promise<void> | void;
}

/** Loose enough to accept both chokidar.watch and an injectable fake for tests. */
export type WatcherFactory = (paths: string, opts: unknown) => WatchHandle;

export interface WatchProjectsOptions {
  log: (message: string) => void;
  notify: (title: string, message: string) => void;
  /** Called when any Hub call (push or delete) reports an unauthorized machine token. */
  onUnauthorized?: () => void;
  /** Per-path debounce window before a change is enqueued. Default 300ms. */
  debounceMs?: number;
  /** Injectable watcher constructor, for deterministic tests. Default chokidar.watch. */
  watcherFactory?: WatcherFactory;
}

export interface WatchHandleResult {
  close: () => void;
}

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Watch every AUTO-mode mapping's local_path for `*.jsonl` add/change
 * (debounced push) and unlink (delete) events, enqueueing the resulting
 * work onto `queue` rather than acting directly.
 */
export function watchProjects(
  queue: SyncQueue,
  api: Api,
  state: AgentState,
  tombstones: Tombstones,
  mappings: AgentMapping[],
  opts: WatchProjectsOptions,
): WatchHandleResult {
  const { log, notify, onUnauthorized, debounceMs = DEFAULT_DEBOUNCE_MS } = opts;
  const watcherFactory: WatcherFactory = opts.watcherFactory ?? (chokidar.watch as unknown as WatcherFactory);

  const watchers: WatchHandle[] = [];
  // Bounded: each entry is deleted the moment its timer fires (audit #13).
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  for (const m of mappings.filter((x) => x.sync_mode === "auto")) {
    const watcher = watcherFactory(m.local_path, {
      ignoreInitial: true,
      depth: 0,
      // No awaitWriteFinish here — see the module-level comment (audit #7):
      // we rely on the short debounce below instead, so live-appending
      // transcripts sync promptly rather than stalling on chokidar's
      // built-in stability window.
    });

    const onChange = (path: string): void => {
      const filename = basename(path);
      if (!filename.endsWith(".jsonl")) return;

      const existing = timers.get(path);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        // Delete the entry first — bounded map, never grows across a long
        // running watch session (audit #13).
        timers.delete(path);

        queue.enqueue(`push:${m.project_id}/${filename}`, async () => {
          // Read at job-run time (not debounce time) so the freshest
          // content is pushed. Guard: the file may have been deleted
          // between the debounce firing and the job actually running.
          const content = await readFile(path, "utf8").catch(() => null);
          if (content === null) return;

          const baseHash = state.get(m.project_id, filename);
          await pushLocal(
            { api, state, tombstones, log, notify, onUnauthorized },
            m.project_id,
            m.local_path,
            filename,
            content,
            baseHash,
          );
        });
      }, debounceMs);
      timer.unref?.();
      timers.set(path, timer);
    };

    const onUnlink = (path: string): void => {
      const filename = basename(path);
      if (!filename.endsWith(".jsonl")) return;

      queue.enqueue(`delete:${m.project_id}/${filename}`, async () => {
        const res = await api.deleteFile(m.project_id, filename);
        if (res.ok) {
          state.del(m.project_id, filename);
          // Tombstone the local-originated delete so reconcile doesn't
          // resurrect it from a Hub manifest that hasn't caught up yet
          // (audit #5). Pruning stale tombstones is a later concern.
          tombstones.add(`${m.project_id}/${filename}`);
          log(`deleted ${filename}`);
        } else if (res.kind === "unauthorized") {
          onUnauthorized?.();
        } else {
          log(`delete ${filename} failed: ${res.kind}`);
        }
      });
    };

    watcher.on("add", onChange);
    watcher.on("change", onChange);
    watcher.on("unlink", onUnlink);
    watchers.push(watcher);
    log(`watching ${m.local_path} (${m.alias ?? m.project_id})`);
  }

  return {
    close: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers) {
        void watcher.close();
      }
    },
  };
}
