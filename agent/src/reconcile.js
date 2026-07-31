import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hashContent } from "./hasher.js";

function localFiles(dir) {
  if (!existsSync(dir)) return {};
  const out = {};
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const content = readFileSync(join(dir, name), "utf8");
    out[name] = { content, hash: hashContent(content) };
  }
  return out;
}

// Push a single local file and reconcile the Hub's response into local state.
export async function pushLocal(api, state, projectId, localPath, fn, content, baseHash, log = () => {}) {
  const res = await api.push(projectId, fn, content, baseHash);
  const d = res.data || {};
  if (res.status === 200 && (d.status === "accepted" || d.status === "unchanged")) {
    state.set(projectId, fn, d.hash);
    if (d.status === "accepted") log(`pushed ${fn}`);
  } else if (res.status === 200 && (d.status === "merged" || d.status === "behind")) {
    const merged = await api.pull(projectId, fn);
    if (merged != null) {
      writeFileSync(join(localPath, fn), merged);
      state.set(projectId, fn, d.hash);
      log(`${d.status} ${fn}`);
    }
  } else if (res.status === 409 && d.status === "conflict") {
    log(`CONFLICT ${fn} — resolve it in the Hub UI`);
  } else {
    log(`push ${fn} unexpected: ${res.status}`);
  }
}

// Reconcile one project: pull Hub-only files, push local-only/changed files.
export async function reconcileProject(api, state, { projectId, localPath }, log = () => {}) {
  mkdirSync(localPath, { recursive: true });
  const manRes = await api.getManifest(projectId);
  if (manRes.status !== 200) { log(`manifest ${projectId} failed: ${manRes.status}`); return; }

  const manifest = new Map((manRes.data || []).map((f) => [f.filename, f]));
  const local = localFiles(localPath);
  const names = new Set([...manifest.keys(), ...Object.keys(local)]);

  for (const fn of names) {
    const hub = manifest.get(fn);
    const loc = local[fn];
    if (hub && !loc) {
      const content = await api.pull(projectId, fn);
      if (content != null) {
        writeFileSync(join(localPath, fn), content);
        state.set(projectId, fn, hub.hash);
        log(`pulled ${fn}`);
      }
    } else if (loc && !hub) {
      await pushLocal(api, state, projectId, localPath, fn, loc.content, null, log);
    } else if (loc && hub) {
      if (loc.hash === hub.hash) state.set(projectId, fn, hub.hash);
      else await pushLocal(api, state, projectId, localPath, fn, loc.content, state.get(projectId, fn), log);
    }
  }
}

// Reconcile every mapped, non-stopped project. Returns the mappings list.
export async function reconcileAll(api, state, log = () => {}) {
  const res = await api.getMappings();
  if (res.status !== 200) { log(`mappings failed: ${res.status}`); return []; }
  for (const m of res.data.filter((x) => x.sync_mode !== "stopped")) {
    await reconcileProject(api, state, { projectId: m.project_id, localPath: m.local_path }, log);
  }
  return res.data;
}

// Pull one file (used on live 'changed' WS message).
export async function pullOne(api, state, mapping, filename, log = () => {}) {
  const content = await api.pull(mapping.project_id, filename);
  if (content == null) return;
  mkdirSync(mapping.local_path, { recursive: true });
  writeFileSync(join(mapping.local_path, filename), content);
  state.set(mapping.project_id, filename, hashContent(content));
  log(`pulled (live) ${filename}`);
}
