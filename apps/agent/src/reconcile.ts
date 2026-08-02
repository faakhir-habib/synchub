// Reconciles local `.jsonl` files against the Hub's manifest for one or
// more projects. Ports legacy `agent/src/reconcile.js` with fixes from the
// agent audit:
//   - tolerant: uses ApiResult — never throws. A failed manifest/mappings
//     fetch skips that unit, not the whole batch (audit #8).
//   - sync_mode-aware: periodic/boot reconcile ("auto" trigger) only
//     processes projects with sync_mode==="auto"; an explicit
//     "manual-project" trigger (e.g. a sync-trigger WS message) processes
//     that one project even if it's "manual" — but never "stopped"
//     (audit #11).
//   - async file I/O via fs/promises (audit #15).
//   - tombstone-aware (durability fix, audit #5): a tombstoned filename is
//     never pulled or pushed. While the Hub still lists it, reconcile
//     re-attempts the delete (idempotent — covers a delete job abandoned
//     on a prior shutdown). Once the Hub confirms it's gone (absent from a
//     fresh manifest), the tombstone is pruned so a legitimately re-created
//     same-named file can sync normally again. Tombstones themselves are
//     added eagerly by the watcher/agent on an observed local unlink or a
//     Hub "deleted" WS frame, and persisted (survive restart) via
//     TombstoneStore — this module reads AND prunes/re-attempts, but never
//     adds one itself.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentMapping } from "@synchub/shared";

import type { Api } from "./api.js";
import { isSafeFilename } from "./safe-filename.js";
import type { AgentState } from "./state.js";
import type { TombstoneStore } from "./tombstones.js";
import { hashContent } from "./hasher.js";

/** Keys are `${projectId}/${filename}` for files the agent itself deleted locally. */
export type Tombstones = TombstoneStore;

export interface ReconcileDeps {
  api: Api;
  state: AgentState;
  tombstones: TombstoneStore;
  log: (message: string) => void;
  notify: (title: string, message: string) => void;
  /** Called when any Hub call reports an unauthorized machine token. */
  onUnauthorized?: () => void;
}

export interface ProjectTarget {
  projectId: number;
  localPath: string;
}

export type ReconcileTrigger =
  | { trigger: "auto" }
  | { trigger: "manual-project"; projectId: number };

interface LocalFile {
  content: string;
  hash: string;
}

/** Read every `*.jsonl` file in `dir`. Returns `{}` if the directory is missing or unreadable. */
async function localFiles(dir: string): Promise<Record<string, LocalFile>> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return {};
  }

  const out: Record<string, LocalFile> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    try {
      const content = await readFile(join(dir, entry.name), "utf8");
      out[entry.name] = { content, hash: hashContent(content) };
    } catch {
      // Unreadable file (permissions, mid-write, ...) — skip it rather
      // than abort the whole directory scan.
    }
  }
  return out;
}

/**
 * Push one local file and reconcile the Hub's response into local state.
 * Never throws: ApiResult failures are logged and skipped; `unauthorized`
 * additionally surfaces via `deps.onUnauthorized`.
 */
export async function pushLocal(
  deps: ReconcileDeps,
  projectId: number,
  localPath: string,
  filename: string,
  content: string,
  baseHash: string | null,
): Promise<void> {
  const { api, state, log, notify } = deps;
  const res = await api.push(projectId, filename, content, baseHash);

  if (!res.ok) {
    if (res.kind === "unauthorized") {
      deps.onUnauthorized?.();
      return;
    }
    log(`push ${filename} failed: ${res.kind}`);
    return;
  }

  const d = res.data;

  try {
    switch (d.status) {
      case "accepted":
      case "unchanged": {
        if (d.hash) state.set(projectId, filename, d.hash);
        if (d.status === "accepted") log(`pushed ${filename}`);
        return;
      }
      case "merged":
      case "behind": {
        const merged = await api.pull(projectId, filename);
        if (merged != null) {
          await writeFile(join(localPath, filename), merged);
          if (d.hash) state.set(projectId, filename, d.hash);
          log(`${d.status} ${filename}`);
          if (d.status === "merged") notify("SyncHub — auto-merged", filename);
        }
        return;
      }
      case "conflict": {
        log(`CONFLICT ${filename} — resolve it in the Hub UI`);
        notify("SyncHub — conflict", `${filename} needs manual resolution in the Hub`);
        return;
      }
      default: {
        const _exhaustive: never = d.status;
        log(`push ${filename}: unknown status ${String(_exhaustive)}`);
        return;
      }
    }
  } catch (err) {
    // pushLocal must never throw: it's called directly (unwrapped) as well
    // as from reconcileProject's try/catch, so any unexpected disk error or
    // rejection here (e.g. writeFile failing) must be caught locally too.
    log(`push ${filename}: unexpected error: ${String(err)}`);
    return;
  }
}

/**
 * Reconcile one project: pull Hub-only files, push local-only/changed
 * files, and handle tombstoned files (never pulled/pushed — see the
 * module-level comment for the re-attempt/prune lifecycle). Tolerant of a
 * failed manifest fetch and of any single bad file — neither aborts the
 * rest of the project.
 */
export async function reconcileProject(deps: ReconcileDeps, target: ProjectTarget): Promise<void> {
  const { api, state, tombstones, log } = deps;
  const { projectId, localPath } = target;

  try {
    await mkdir(localPath, { recursive: true });
  } catch (err) {
    log(`mkdir ${localPath} failed: ${String(err)}`);
    return;
  }

  const man = await api.getManifest(projectId);
  if (!man.ok) {
    if (man.kind === "unauthorized") deps.onUnauthorized?.();
    log(`manifest ${projectId} failed: ${man.kind}`);
    return;
  }

  const manifest = new Map(man.data.map((f) => [f.filename, f]));
  const local = await localFiles(localPath);
  // Fold in this project's currently-tombstoned filenames too: a fully
  // confirmed delete (Hub no longer lists it AND it's gone locally) would
  // otherwise never appear in manifest/local at all, so it would never be
  // visited below to get pruned — it'd sit in the store forever.
  const prefix = `${projectId}/`;
  const tombstonedFilenames = tombstones
    .list()
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
  const names = new Set([...manifest.keys(), ...Object.keys(local), ...tombstonedFilenames]);

  for (const filename of names) {
    try {
      const hub = manifest.get(filename);
      const loc = local[filename];
      const key = `${projectId}/${filename}`;

      // hub-supplied (manifest) filenames are untrusted: reject anything
      // that could escape localPath via join() before it's ever pulled or
      // written (path-traversal guard).
      if (hub && !isSafeFilename(filename)) {
        log(`reconcile: unsafe filename "${filename}" in project ${projectId}'s Hub manifest — skipped (possible traversal)`);
        continue;
      }

      if (tombstones.has(key)) {
        // Never pull or push a tombstoned file, regardless of local
        // presence — this module never deletes a LOCAL file, and only
        // ever re-attempts a hub delete that's already carried by an
        // explicit, previously-observed tombstone (no mass-delete on a
        // vanished folder).
        if (hub) {
          // The Hub still lists it — either the original delete job never
          // reached the Hub, or it was abandoned on a prior shutdown.
          // Re-attempting is idempotent (api.deleteFile on an
          // already-absent file is a no-op success on the Hub side).
          const r = await api.deleteFile(projectId, filename);
          if (r.ok) {
            state.del(projectId, filename);
            log(`re-propagated delete ${key}`);
          } else if (r.kind === "unauthorized") {
            deps.onUnauthorized?.();
          } else {
            log(`delete re-attempt failed ${key}: ${r.kind}`);
          }
        } else {
          // The Hub no longer has it — the delete is confirmed. Prune the
          // tombstone so a future legitimately re-created same-named file
          // syncs normally instead of being blocked forever.
          tombstones.delete(key);
          log(`delete confirmed, tombstone pruned ${key}`);
        }
        continue;
      }

      if (hub && !loc) {
        // Hub-only (and not tombstoned — handled above).
        const content = await api.pull(projectId, filename);
        if (content != null) {
          await writeFile(join(localPath, filename), content);
          state.set(projectId, filename, hub.hash);
          log(`pulled ${filename}`);
        }
      } else if (loc && !hub) {
        await pushLocal(deps, projectId, localPath, filename, loc.content, null);
      } else if (loc && hub) {
        if (loc.hash === hub.hash) {
          state.set(projectId, filename, hub.hash);
        } else {
          await pushLocal(deps, projectId, localPath, filename, loc.content, state.get(projectId, filename));
        }
      }
    } catch (err) {
      // One bad file must never abort the rest of the project's reconcile.
      log(`reconcile ${filename} in project ${projectId} failed: ${String(err)}`);
    }
  }
}

function shouldInclude(mapping: AgentMapping, trigger: ReconcileTrigger): boolean {
  if (trigger.trigger === "auto") return mapping.sync_mode === "auto";
  return mapping.project_id === trigger.projectId && mapping.sync_mode !== "stopped";
}

/**
 * Reconcile mapped projects per `trigger`:
 *   - `{trigger:"auto"}` (periodic/boot reconcile): only sync_mode==="auto".
 *   - `{trigger:"manual-project", projectId}` (explicit sync-trigger):
 *     that one project, unless its sync_mode is "stopped".
 * Tolerant of a failed mappings fetch (logs + returns). Projects are
 * reconciled sequentially; the SyncQueue is what serializes across
 * separate reconcileAll invocations.
 */
export async function reconcileAll(deps: ReconcileDeps, trigger: ReconcileTrigger): Promise<void> {
  const { api, log } = deps;
  const res = await api.getMappings();
  if (!res.ok) {
    if (res.kind === "unauthorized") deps.onUnauthorized?.();
    log(`mappings failed: ${res.kind}`);
    return;
  }

  const targets = res.data.filter((m) => shouldInclude(m, trigger));
  for (const m of targets) {
    await reconcileProject(deps, { projectId: m.project_id, localPath: m.local_path });
  }
}
