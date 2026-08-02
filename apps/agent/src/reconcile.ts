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
//   - tombstone-aware: won't re-pull a file the agent itself just deleted
//     (resurrection fix, audit #5). This module only *reads* the
//     tombstone set — later tasks (watcher/agent) own adding/removing
//     entries as local deletes are propagated and later observed as
//     absent from a fresh manifest.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentMapping } from "@synchub/shared";

import type { Api } from "./api.js";
import type { AgentState } from "./state.js";
import { hashContent } from "./hasher.js";

/** Keys are `${projectId}/${filename}` for files the agent itself deleted locally. */
export type Tombstones = Set<string>;

export interface ReconcileDeps {
  api: Api;
  state: AgentState;
  tombstones: Tombstones;
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
  }
}

/**
 * Reconcile one project: pull Hub-only files, push local-only/changed
 * files, and skip files this agent has a tombstone for (so a Hub manifest
 * entry that hasn't caught up to a local delete doesn't get resurrected
 * locally). Tolerant of a failed manifest fetch and of any single bad
 * file — neither aborts the rest of the project.
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
    log(`manifest ${projectId} failed: ${man.kind}`);
    return;
  }

  const manifest = new Map(man.data.map((f) => [f.filename, f]));
  const local = await localFiles(localPath);
  const names = new Set([...manifest.keys(), ...Object.keys(local)]);

  for (const filename of names) {
    try {
      const hub = manifest.get(filename);
      const loc = local[filename];

      if (hub && !loc) {
        // Hub-only. Don't resurrect a file this agent just deleted locally.
        if (tombstones.has(`${projectId}/${filename}`)) continue;
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
    log(`mappings failed: ${res.kind}`);
    return;
  }

  const targets = res.data.filter((m) => shouldInclude(m, trigger));
  for (const m of targets) {
    await reconcileProject(deps, { projectId: m.project_id, localPath: m.local_path });
  }
}
