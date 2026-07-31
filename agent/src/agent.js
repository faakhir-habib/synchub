import { createApi } from "./api.js";
import { createState } from "./state.js";
import { reconcileAll, reconcileProject, pullOne } from "./reconcile.js";
import { watchProjects } from "./watcher.js";
import { connectWs } from "./ws.js";

// Boot the agent: reconcile everything, start watching, connect the live relay.
export async function runAgent({ config, statePath }, log = () => {}) {
  const api = createApi(config);
  const state = createState(statePath);

  log("reconciling...");
  let mappings = await reconcileAll(api, state, log);
  log(`reconciled ${mappings.length} project(s)`);

  let watch = watchProjects(api, state, mappings, log);

  const ws = connectWs(config, async (msg) => {
    try {
      if (msg.type === "changed") {
        const m = mappings.find((x) => x.project_id === msg.projectId);
        if (m) await pullOne(api, state, m, msg.filename, log);
      } else if (msg.type === "sync") {
        const m = mappings.find((x) => x.project_id === msg.projectId);
        if (m) await reconcileProject(api, state, { projectId: m.project_id, localPath: m.local_path }, log);
      }
    } catch (e) {
      log(`ws handler error: ${e.message}`);
    }
  }, log);

  return {
    stop: async () => { await watch.close(); ws.close(); },
  };
}
