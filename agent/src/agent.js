import { createApi } from "./api.js";
import { createState } from "./state.js";
import { reconcileAll, reconcileProject, pullOne } from "./reconcile.js";
import { watchProjects } from "./watcher.js";
import { connectWs } from "./ws.js";
import { createNotifier } from "./notifier.js";

// Boot the agent: reconcile everything, start watching, connect the live relay.
export async function runAgent({ config, statePath }, log = () => {}) {
  const api = createApi(config);
  const state = createState(statePath);
  const notifier = createNotifier(config.notifications !== false);
  const notify = (title, message) => notifier.notify(title, message);

  log("reconciling...");
  let mappings = await reconcileAll(api, state, log, notify);
  log(`reconciled ${mappings.length} project(s)`);

  let watch = watchProjects(api, state, mappings, log, notify);

  const ws = connectWs(config, async (msg) => {
    try {
      if (msg.type === "changed") {
        const m = mappings.find((x) => x.project_id === msg.projectId);
        if (m) await pullOne(api, state, m, msg.filename, log, notify);
      } else if (msg.type === "sync") {
        const m = mappings.find((x) => x.project_id === msg.projectId);
        if (m) await reconcileProject(api, state, { projectId: m.project_id, localPath: m.local_path }, log, notify);
      }
    } catch (e) {
      log(`ws handler error: ${e.message}`);
    }
  }, log);

  // Periodically re-reconcile so newly mapped/unmapped projects (or projects
  // added in the UI after the agent started) are picked up without a restart.
  const key = (ms) => ms.map((m) => `${m.project_id}:${m.local_path}:${m.sync_mode}`).sort().join("|");
  const timer = setInterval(async () => {
    try {
      const next = await reconcileAll(api, state, log, notify);
      if (key(next) !== key(mappings)) {
        log(`mappings changed — now watching ${next.length} project(s)`);
        await watch.close();
        mappings = next;
        watch = watchProjects(api, state, mappings, log, notify);
      } else {
        mappings = next;
      }
    } catch (e) { log(`reconcile loop error: ${e.message}`); }
  }, 30000);

  return {
    stop: async () => { clearInterval(timer); await watch.close(); ws.close(); },
  };
}
