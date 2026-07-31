import chokidar from "chokidar";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pushLocal } from "./reconcile.js";

// Watch each AUTO-mode mapped folder for *.jsonl changes and push (debounced).
export function watchProjects(api, state, mappings, log = () => {}, notify = () => {}, debounceMs = 1500) {
  const timers = new Map();
  const watchers = [];

  for (const m of mappings.filter((x) => x.sync_mode === "auto")) {
    const watcher = chokidar.watch(m.local_path, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    const onChange = (path) => {
      if (!path.endsWith(".jsonl")) return;
      const fn = basename(path);
      clearTimeout(timers.get(path));
      timers.set(path, setTimeout(async () => {
        try {
          const content = readFileSync(path, "utf8");
          await pushLocal(api, state, m.project_id, m.local_path, fn, content, state.get(m.project_id, fn), log, notify);
        } catch (e) {
          log(`watch push error ${fn}: ${e.message}`);
        }
      }, debounceMs));
    };
    watcher.on("add", onChange).on("change", onChange);
    watchers.push(watcher);
    log(`watching ${m.local_path} (${m.alias})`);
  }

  return { close: () => Promise.all(watchers.map((w) => w.close())) };
}
