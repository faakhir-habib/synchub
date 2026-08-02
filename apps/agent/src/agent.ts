// Boots the agent: fetches mappings, starts the watcher, connects the live
// WS relay, and ties everything together through a single SyncQueue so
// pushes/pulls/deletes/reconciles never race each other. Ports legacy
// `agent/src/agent.js` with fixes from the agent audit:
//   - ALL work (boot reconcile, WS-driven pull/sync, deletes, periodic
//     reconcile) is enqueued onto the SyncQueue rather than run directly,
//     so a WS "changed" event can never race a concurrent watcher push or
//     periodic reconcile for the same project/file.
//   - reconnect catch-up (audit #9): every (re)connect of the WS — not
//     just the first — enqueues a fresh auto reconcile, so events missed
//     while disconnected are picked up.
//   - unauthorized re-pair guidance (audit #10): any Hub call that reports
//     an unauthorized machine token logs a clear "re-pair this machine"
//     message instead of failing silently/looping.
//   - mapping-diff watcher refresh: the periodic tick re-fetches mappings
//     and only tears down/recreates the watcher set when the auto-mapping
//     set actually changed (same diff legacy used).
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import type { AgentMapping, WsMessage } from "@synchub/shared";

import { createApi } from "./api.js";
import type { Api } from "./api.js";
import type { AgentConfig } from "./config.js";
import { createNotifier } from "./notifier.js";
import { reconcileAll, reconcileProject } from "./reconcile.js";
import type { ReconcileDeps } from "./reconcile.js";
import { isSafeFilename } from "./safe-filename.js";
import { createState } from "./state.js";
import type { AgentState } from "./state.js";
import { createTombstones } from "./tombstones.js";
import type { TombstoneStore } from "./tombstones.js";
import { SyncQueue } from "./sync-queue.js";
import { connectWs } from "./ws.js";
import type { WsFactory, WsHandle } from "./ws.js";
import { watchProjects } from "./watcher.js";
import type { WatcherFactory, WatchHandleResult } from "./watcher.js";

export interface RunAgentOptions {
  statePath?: string;
  /** Path to the persisted tombstone store. Defaults to tombstonePath(); overridable for tests, mirroring statePath. */
  tombstonePath?: string;
  log?: (message: string) => void;
  notify?: (title: string, message: string) => void;
  apiFactory?: (cfg: { hubUrl: string; machineToken: string }) => Api;
  stateFactory?: (path?: string) => AgentState;
  tombstoneFactory?: (path?: string) => TombstoneStore;
  watcherFactory?: WatcherFactory;
  wsFactory?: WsFactory;
  /** Periodic reconcile + mapping-refresh interval. Default 30000ms. */
  tickMs?: number;
}

export interface AgentHandle {
  /** Stop everything: ws, watcher, queue (drained/bounded), state (flushed). */
  stop: () => Promise<void>;
  /** Test/observability seam: resolves once boot has finished and the queue has gone idle. */
  whenIdle: () => Promise<void>;
}

const DEFAULT_TICK_MS = 30000;

/** Same diff key legacy used: order-independent, catches added/removed/moved/mode-changed mappings. */
function mappingsKey(ms: AgentMapping[]): string {
  return ms
    .map((m) => `${m.project_id}:${m.local_path}:${m.sync_mode}`)
    .sort()
    .join("|");
}

/** Boot the agent and return a handle to stop it. Never throws — every seam is guarded. */
export function runAgent(cfg: AgentConfig, opts: RunAgentOptions = {}): AgentHandle {
  const log = opts.log ?? ((): void => {});
  const notify = opts.notify ?? createNotifier(cfg.notifications !== false).notify;
  const api = (opts.apiFactory ?? createApi)(cfg);
  const state = (opts.stateFactory ?? createState)(opts.statePath);
  const tombstones: TombstoneStore = (opts.tombstoneFactory ?? createTombstones)(opts.tombstonePath);

  const queue = new SyncQueue({
    onError: (err, key) => log(`queue task "${key}" failed: ${String(err)}`),
  });

  // Audit #10: any Hub call reporting an unauthorized machine token gets a
  // clear, actionable log line rather than a silent/looping failure. Kept
  // simple per the plan — logging every time is fine (no dedup state).
  function onUnauthorized(): void {
    log(
      "machine token revoked or invalid — re-pair this machine: run `synchub-agent pair <CODE> <HUB_URL>`",
    );
  }

  const reconcileDeps: ReconcileDeps = { api, state, tombstones, log, notify, onUnauthorized };

  let currentMappings: AgentMapping[] = [];
  let watcher: WatchHandleResult = { close: (): void => {} };

  function findMapping(projectId: number): AgentMapping | undefined {
    return currentMappings.find((m) => m.project_id === projectId);
  }

  function enqueueReconcileAll(): void {
    queue.enqueue("reconcile:all", () => reconcileAll(reconcileDeps, { trigger: "auto" }));
  }

  function dispatch(msg: WsMessage): void {
    switch (msg.type) {
      case "welcome": {
        log(`ws welcome${msg.machineId !== undefined ? ` (machine ${msg.machineId})` : ""}`);
        return;
      }

      case "changed": {
        // The Hub has a newer version of this file. reconcileProject is
        // safe + idempotent (diffs the whole project against the Hub
        // manifest) and handles the single-file pull; heavier than a
        // targeted pull of just this file, but simpler and correct.
        const m = findMapping(msg.projectId);
        if (!m) {
          log(`changed: project ${msg.projectId} isn't mapped locally — skipped`);
          return;
        }
        queue.enqueue(`reconcile:project:${msg.projectId}`, () =>
          reconcileProject(reconcileDeps, { projectId: m.project_id, localPath: m.local_path }),
        );
        return;
      }

      case "sync-trigger": {
        // Explicit manual "sync now" — allowed even for sync_mode "manual".
        const m = findMapping(msg.projectId);
        if (!m) {
          log(`sync-trigger: project ${msg.projectId} isn't mapped locally — skipped`);
          return;
        }
        queue.enqueue(`reconcile:project:${msg.projectId}`, () =>
          reconcileAll(reconcileDeps, { trigger: "manual-project", projectId: msg.projectId }),
        );
        return;
      }

      case "deleted": {
        const { projectId, filename } = msg;
        if (!isSafeFilename(filename)) {
          log(`deleted: unsafe filename "${filename}" from project ${projectId} — skipped (possible traversal)`);
          return;
        }

        // Tombstone EAGERLY — synchronously, before the job below is even
        // enqueued — so the durable intent survives even if that job is
        // later abandoned (e.g. still pending, dropped by SyncQueue.close()
        // on shutdown, never having run): reconcile will see the persisted
        // tombstone on its next pass regardless and re-attempt the Hub
        // delete itself (audit #5).
        tombstones.add(`${projectId}/${filename}`);

        queue.enqueue(`delete:${projectId}/${filename}`, async () => {
          const m = findMapping(projectId);
          if (!m) {
            log(`deleted: project ${projectId} isn't mapped locally — skipped`);
            return;
          }
          await unlink(join(m.local_path, filename)).catch(() => {
            // Already gone / never existed locally — fine, that's the goal.
          });
          state.del(projectId, filename);
          log(`removed ${filename} (deleted on Hub)`);
        });
        return;
      }

      default: {
        // presence / sync-progress / sync-complete / conflict / notification
        // are browser-directed frames — nothing for the agent to do.
        return;
      }
    }
  }

  const ws: WsHandle = connectWs(cfg, {
    wsFactory: opts.wsFactory,
    log,
    onMessage: dispatch,
    // Audit #9: every (re)connect — including the first — enqueues a full
    // catch-up reconcile. Harmless/coalesced alongside the boot reconcile
    // below (same "reconcile:all" key), and essential after a reconnect
    // where WS events may have been missed while disconnected.
    onOpen: () => enqueueReconcileAll(),
  });

  function startWatcher(mappings: AgentMapping[]): WatchHandleResult {
    return watchProjects(queue, api, state, tombstones, mappings, {
      log,
      notify,
      onUnauthorized,
      watcherFactory: opts.watcherFactory,
    });
  }

  async function refreshMappings(): Promise<void> {
    const res = await api.getMappings();
    if (!res.ok) {
      if (res.kind === "unauthorized") onUnauthorized();
      log(`mappings refresh failed: ${res.kind}`);
      return;
    }

    const next = res.data;
    if (mappingsKey(next) !== mappingsKey(currentMappings)) {
      const autoCount = next.filter((m) => m.sync_mode === "auto").length;
      log(`mappings changed — now watching ${autoCount} auto project(s)`);
      // NOTE: closing+recreating the watcher drops any debounce timer that
      // hasn't fired yet for a file mid-edit at the moment mappings change
      // — that edit isn't pushed until its next write (or the reconcile
      // enqueued alongside every tick picks it up on the next pass).
      // Acceptable: reconcile is safe/idempotent and this window is only
      // ever as wide as the tick interval.
      watcher.close();
      currentMappings = next;
      watcher = startWatcher(currentMappings);
    } else {
      currentMappings = next;
    }
  }

  const tick = setInterval(() => {
    enqueueReconcileAll();
    void refreshMappings();
  }, opts.tickMs ?? DEFAULT_TICK_MS);
  tick.unref?.();

  // Boot sequence: fetch initial mappings (tolerant of failure), start the
  // watcher over them, and enqueue the auto-only boot reconcile. Kicked off
  // immediately but NOT awaited by the synchronous return (runAgent itself
  // must return synchronously so cmdRun can wire signal handlers without
  // awaiting); `whenIdle()` lets callers (and tests) observe when boot —
  // and anything it enqueues — has settled.
  const ready = (async (): Promise<void> => {
    const res = await api.getMappings();
    if (res.ok) {
      currentMappings = res.data;
    } else {
      if (res.kind === "unauthorized") onUnauthorized();
      log(`initial mappings fetch failed: ${res.kind} — starting with no watched projects`);
      currentMappings = [];
    }

    watcher = startWatcher(currentMappings);
    enqueueReconcileAll();
  })();

  return {
    whenIdle: async (): Promise<void> => {
      await ready;
      await queue.whenIdle();
    },
    stop: async (): Promise<void> => {
      await ready.catch(() => {
        // Boot itself never rejects (all awaits above are guarded), but
        // stop() must not hang even if that assumption is ever violated.
      });
      clearInterval(tick);
      ws.close();
      watcher.close();
      await queue.close();
      state.close();
      tombstones.close();
    },
  };
}
