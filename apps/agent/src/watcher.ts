// Watches each AUTO-mode mapped folder for *.jsonl changes and enqueues
// push/delete work onto the SyncQueue (debounced). Ports legacy
// `agent/src/watcher.js` with fixes from the agent audit:
//   - incremental/faster live push (audit #7): legacy used chokidar's
//     awaitWriteFinish({stabilityThreshold: 500, ...}) on TOP OF its own
//     1500ms debounce, so a live-appending transcript could stall ~2s
//     before syncing. Here we drop awaitWriteFinish entirely and rely
//     solely on a short internal debounce (default 300ms) per path, so
//     appends sync promptly while still coalescing bursty writes.
//   - unlink handling (audit #5/#12): a local delete tombstones the file
//     EAGERLY (synchronously, before/at enqueue time) so the durable
//     intent survives even if the enqueued delete job never runs (e.g.
//     abandoned on shutdown) — reconcile re-attempts the Hub delete on a
//     later pass. The enqueued job then calls api.deleteFile + state.del.
//     Pruning stale tombstones once the Hub confirms the delete is
//     reconcile's job, not this module's.
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
import type { SyncQueue } from "./sync-queue.js";
import type { AgentState } from "./state.js";
import type { TombstoneStore } from "./tombstones.js";

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
  tombstones: TombstoneStore,
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

        // A local add/change is an explicit "this file should exist again"
        // signal: clear any existing tombstone for it BEFORE enqueuing the
        // push. Without this, a file deleted (tombstoned) then recreated/
        // edited under the same name — before the Hub delete was confirmed
        // — would keep looking tombstoned to reconcile, which would keep
        // re-issuing api.deleteFile for it forever instead of letting the
        // recreate sync normally. This does not reopen the resurrection
        // guard (audit #5): that guard only blocks re-PULLING a file the
        // user deleted; once the user recreates it locally, the file exists
        // locally again, so there's nothing left to resurrect.
        tombstones.delete(`${m.project_id}/${filename}`);

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

      // Tombstone EAGERLY — synchronously, at the moment the unlink is
      // observed, not only once the enqueued delete job succeeds. This
      // makes the delete intent durable even if the job below never runs
      // (e.g. the agent is stopped before the queue drains it): reconcile
      // will see the persisted tombstone on a later pass and re-attempt
      // the Hub delete itself (audit #5).
      tombstones.add(`${m.project_id}/${filename}`);

      queue.enqueue(`delete:${m.project_id}/${filename}`, async () => {
        const res = await api.deleteFile(m.project_id, filename);
        if (res.ok) {
          state.del(m.project_id, filename);
          log(`deleted ${filename}`);
        } else if (res.kind === "unauthorized") {
          onUnauthorized?.();
        } else {
          // Leave state as-is (reconcile re-derives it) — the tombstone
          // added above stays put; it's the durable intent, and reconcile
          // will keep re-attempting the Hub delete on later passes.
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
