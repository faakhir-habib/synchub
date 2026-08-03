# Sync each project's `memory/` folder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync top-level `memory/*.md` files in each mapped project through SyncHub's existing push/merge/conflict pipeline, keyed as `memory/<name>.md`.

**Architecture:** Memory files reuse the existing flat `filename` model — the Hub already treats `filename` as an opaque string keyed by hash, so no Hub schema, endpoint, or merge change is needed. All work is on the agent side (watcher + reconcile) plus relaxing the shared `isSafeFilename` guard (mirrored agent + Hub) to admit a single `memory/<basename>.md` shape. Divergent in-place edits conflict safely because `autoMerge` returns `conflict` when a tail line isn't valid JSON (markdown never is).

**Tech Stack:** TypeScript, Node (fs/promises, chokidar) on the agent; NestJS on the Hub; Vitest for tests on both.

**Reference spec:** `docs/superpowers/specs/2026-08-03-sync-memory-folder-design.md`

---

## File Structure

- `apps/agent/src/safe-filename.ts` — relax guard (agent copy). Test: `safe-filename.test.ts`.
- `apps/hub-api/src/sync/sync.service.ts` — relax the exported `isSafeFilename` (Hub copy). New test: `apps/hub-api/src/sync/safe-filename.test.ts`.
- `apps/agent/src/watcher.ts` — watch `memory/*.md` (depth 1) + a `relSyncName` mapper. Test: `watcher.test.ts`.
- `apps/agent/src/reconcile.ts` — scan `memory/*.md` in `localFiles`, `mkdir` the memory dir before writing pulled memory files. Test: `reconcile.test.ts`.
- `apps/hub-api/src/sync/merge.service.test.ts` — add coverage proving markdown conflict/forward behavior (no production change).

Pre-flight verified during planning: Express 4.22.1 decodes a `%2F` path param back to `memory/…`, and the agent already wraps the pull filename in `encodeURIComponent` (`api.ts:113`), so `memory/foo.md` round-trips with no Hub route change.

---

### Task 1: Agent `isSafeFilename` — admit `memory/<name>.md`

**Files:**
- Modify: `apps/agent/src/safe-filename.ts`
- Test: `apps/agent/src/safe-filename.test.ts`

- [ ] **Step 1: Add failing tests**

Add these cases to `apps/agent/src/safe-filename.test.ts`. Put the accept cases inside the existing `it.each([...])("accepts %j")` array and the reject cases inside the existing `it.each([...])("rejects %j (%s)")` array:

Accepts (add to the accepts array):
```ts
    ["memory/MEMORY.md"],
    ["memory/notes.md"],
    ["memory/My-Note_1.md"],
```

Rejects (add to the rejects array):
```ts
    ["memory/notes.txt", "memory file not .md"],
    ["memory/a/b.md", "nested under memory"],
    ["memory/..md", "dot-dot in memory basename"],
    ["memory/", "empty memory basename"],
    ["memory/..", "memory parent traversal"],
    ["notes/foo.md", "non-memory subfolder"],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agent && pnpm exec vitest run src/safe-filename.test.ts`
Expected: FAIL — `memory/MEMORY.md` currently rejected (contains `/`), so the new accept cases fail.

- [ ] **Step 3: Implement the relaxed guard**

Replace the entire body of `apps/agent/src/safe-filename.ts` with:

```ts
// Guards a filename before it is joined onto a local sync directory. Two shapes
// are safe: a plain top-level basename (e.g. `chat.jsonl`) or a single-level
// memory note (`memory/<basename>.md`). Everything else — deeper nesting,
// traversal (`..`), separators inside a basename, absolute paths — is rejected.
// Mirrors hub-api's `isSafeFilename` (apps/hub-api/src/sync/sync.service.ts).
import { isAbsolute } from "node:path";

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const MEMORY_PREFIX = "memory/";

/** A plain, non-traversing basename: charset-clean, no `..`, no NUL, non-empty. */
function isSafeBasename(base: string): boolean {
  if (base.length === 0) return false;
  if (base.includes("..")) return false;
  if (base.includes("\0")) return false;
  return SAFE_NAME.test(base);
}

/** True iff `name` is safe to join onto a local sync directory. */
export function isSafeFilename(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name.includes("\0")) return false;
  if (isAbsolute(name)) return false;

  if (name.startsWith(MEMORY_PREFIX)) {
    const base = name.slice(MEMORY_PREFIX.length);
    return base.endsWith(".md") && isSafeBasename(base);
  }

  if (name.includes("/") || name.includes("\\")) return false;
  return isSafeBasename(name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agent && pnpm exec vitest run src/safe-filename.test.ts`
Expected: PASS — all existing and new cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/safe-filename.ts apps/agent/src/safe-filename.test.ts
git commit -m "feat(agent): allow memory/<name>.md in isSafeFilename"
```

---

### Task 2: Hub `isSafeFilename` — admit `memory/<name>.md`

**Files:**
- Modify: `apps/hub-api/src/sync/sync.service.ts:26-30` (the exported `isSafeFilename` + `SAFE_NAME`)
- Create: `apps/hub-api/src/sync/safe-filename.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/hub-api/src/sync/safe-filename.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isSafeFilename } from "./sync.service.js";

describe("hub isSafeFilename", () => {
  it.each([
    ["session.jsonl"],
    ["a.jsonl"],
    ["no-extension"],
    ["memory/MEMORY.md"],
    ["memory/notes.md"],
    ["memory/My-Note_1.md"],
  ])("accepts %j", (name) => {
    expect(isSafeFilename(name)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["a/b", "bare separator"],
    ["memory/notes.txt", "memory file not .md"],
    ["memory/a/b.md", "nested under memory"],
    ["memory/..md", "dot-dot in memory basename"],
    ["memory/", "empty memory basename"],
    ["memory/..", "memory parent traversal"],
    ["notes/foo.md", "non-memory subfolder"],
  ])("rejects %j (%s)", (name) => {
    expect(isSafeFilename(name)).toBe(false);
  });

  it("rejects a name longer than 255 chars", () => {
    expect(isSafeFilename("a".repeat(256))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/hub-api && pnpm exec vitest run src/sync/safe-filename.test.ts`
Expected: FAIL — `memory/MEMORY.md` currently rejected (the `/` fails `SAFE_NAME`).

- [ ] **Step 3: Implement the relaxed guard**

In `apps/hub-api/src/sync/sync.service.ts`, replace the current block:

```ts
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function isSafeFilename(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 255 && SAFE_NAME.test(name);
}
```

with:

```ts
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const MEMORY_PREFIX = "memory/";

// A plain, non-traversing basename. Mirrors the agent's isSafeBasename.
function isSafeBasename(base: string): boolean {
  return base.length > 0 && !base.includes("..") && SAFE_NAME.test(base);
}

// A filename is either a plain top-level basename (a Claude session transcript,
// e.g. UUID.jsonl) or a single-level memory note (memory/<basename>.md). The
// plain branch is unchanged from before; the memory branch is the new shape.
export function isSafeFilename(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name.startsWith(MEMORY_PREFIX)) {
    const base = name.slice(MEMORY_PREFIX.length);
    return base.endsWith(".md") && isSafeBasename(base);
  }
  return SAFE_NAME.test(name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/hub-api && pnpm exec vitest run src/sync/safe-filename.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/sync/sync.service.ts apps/hub-api/src/sync/safe-filename.test.ts
git commit -m "feat(hub-api): allow memory/<name>.md in isSafeFilename"
```

---

### Task 3: Watcher — watch `memory/*.md` at depth 1

**Files:**
- Modify: `apps/agent/src/watcher.ts`
- Test: `apps/agent/src/watcher.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests inside the `describe("watchProjects", …)` block in `apps/agent/src/watcher.test.ts` (they reuse the file's existing `mapping`, `makeFakeWatcher`, `makeQueue`, `makeState`, `makeApi`, `makeTombstones`, `readFileMock`, `pushLocalSpy`, `log`, `notify` helpers):

```ts
  it("debounces a memory/*.md change and enqueues a push keyed memory/<name>", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const state = makeState({ get: vi.fn(() => "mem-base") });
    const api = makeApi();

    const handle = watchProjects(queue as never, api, state, makeTombstones(), [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    const path = join("C:\\proj1", "memory", "notes.md");
    watcher.emit("change", path);
    await vi.advanceTimersByTimeAsync(300);

    expect(queue.has("push:1/memory/notes.md")).toBe(true);

    readFileMock.mockResolvedValue("mem-content");
    await queue.run("push:1/memory/notes.md");

    expect(pushLocalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api, state }),
      1,
      "C:\\proj1",
      "memory/notes.md",
      "mem-content",
      "mem-base",
    );

    handle.close();
  });

  it("ignores files in non-memory subfolders and non-.md files in memory", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();

    const handle = watchProjects(queue as never, makeApi(), makeState(), makeTombstones(), [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    watcher.emit("change", join("C:\\proj1", "some-session", "x.jsonl"));
    watcher.emit("change", join("C:\\proj1", "memory", "scratch.txt"));
    await vi.advanceTimersByTimeAsync(300);

    expect(queue.enqueue).not.toHaveBeenCalled();
    handle.close();
  });

  it("tombstones + enqueues a delete for a memory/*.md unlink", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const tombstones = makeTombstones();
    const api = makeApi();

    const handle = watchProjects(queue as never, api, makeState(), tombstones, [m], {
      log,
      notify,
      watcherFactory: () => watcher,
    });

    watcher.emit("unlink", join("C:\\proj1", "memory", "notes.md"));

    expect(tombstones.has("1/memory/notes.md")).toBe(true);
    expect(queue.has("delete:1/memory/notes.md")).toBe(true);

    await queue.run("delete:1/memory/notes.md");
    expect(api.deleteFile).toHaveBeenCalledWith(1, "memory/notes.md");

    handle.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agent && pnpm exec vitest run src/watcher.test.ts`
Expected: FAIL — memory paths are currently ignored (basename `notes.md` doesn't end in `.jsonl`), so no job is enqueued.

- [ ] **Step 3: Implement the watcher change**

In `apps/agent/src/watcher.ts`:

(a) Change the import line
```ts
import { basename } from "node:path";
```
to
```ts
import { relative } from "node:path";
```

(b) Add this exported helper just below the `const DEFAULT_DEBOUNCE_MS = 300;` line:

```ts
/**
 * Map an absolute event path to its Hub sync key, or null if it isn't a file we
 * sync. Under a mapped folder we sync exactly two shapes:
 *   - a top-level transcript:  `<name>.jsonl`     → key `<name>.jsonl`
 *   - a top-level memory note: `memory/<name>.md` → key `memory/<name>.md`
 * Everything else (other subfolders, non-.md files in memory/, deeper nesting)
 * is ignored. The key always uses '/' so it matches the Hub's filename format.
 */
export function relSyncName(localPath: string, filePath: string): string | null {
  const rel = relative(localPath, filePath);
  if (rel === "" || rel.startsWith("..")) return null;
  const segs = rel.split(/[\\/]/);
  if (segs.length === 1) {
    return segs[0].endsWith(".jsonl") ? segs[0] : null;
  }
  if (segs.length === 2 && segs[0] === "memory") {
    return segs[1].endsWith(".md") ? `memory/${segs[1]}` : null;
  }
  return null;
}
```

(c) In the `watcherFactory(m.local_path, { … })` options object, change `depth: 0` to `depth: 1`. Update the adjacent comment's "top level" wording to note memory files live one level down, e.g.:
```ts
      ignoreInitial: true,
      // depth 1 so top-level *.jsonl transcripts AND memory/*.md notes are both
      // seen; relSyncName filters every event down to those two shapes.
      depth: 1,
```

(d) Replace the whole `onChange` function with:

```ts
    const onChange = (path: string): void => {
      const syncName = relSyncName(m.local_path, path);
      if (syncName === null) return;

      const existing = timers.get(path);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        timers.delete(path);
        tombstones.delete(`${m.project_id}/${syncName}`);

        queue.enqueue(`push:${m.project_id}/${syncName}`, async () => {
          const content = await readFile(path, "utf8").catch(() => null);
          if (content === null) return;

          const baseHash = state.get(m.project_id, syncName);
          await pushLocal(
            { api, state, tombstones, log, notify, onUnauthorized },
            m.project_id,
            m.local_path,
            syncName,
            content,
            baseHash,
          );
        });
      }, debounceMs);
      timer.unref?.();
      timers.set(path, timer);
    };
```

(e) Replace the whole `onUnlink` function with:

```ts
    const onUnlink = (path: string): void => {
      const syncName = relSyncName(m.local_path, path);
      if (syncName === null) return;

      tombstones.add(`${m.project_id}/${syncName}`);

      queue.enqueue(`delete:${m.project_id}/${syncName}`, async () => {
        const res = await api.deleteFile(m.project_id, syncName);
        if (res.ok) {
          state.del(m.project_id, syncName);
          log(`deleted ${syncName}`);
        } else if (res.kind === "unauthorized") {
          onUnauthorized?.();
        } else {
          log(`delete ${syncName} failed: ${res.kind}`);
        }
      });
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agent && pnpm exec vitest run src/watcher.test.ts`
Expected: PASS — the new memory tests plus all existing `.jsonl` tests (they still resolve to the same keys via `relSyncName`).

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/watcher.ts apps/agent/src/watcher.test.ts
git commit -m "feat(agent): watch memory/*.md and sync as memory/<name>.md"
```

---

### Task 4: Reconcile — scan and pull `memory/*.md`

**Files:**
- Modify: `apps/agent/src/reconcile.ts`
- Test: `apps/agent/src/reconcile.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests inside the top-level `describe("reconcile", …)` block in `apps/agent/src/reconcile.test.ts` (they reuse the file's `deps`, `makeApi`, `localDir`, `state` helpers, plus the already-imported `mkdirSync`, `writeFileSync`, `readFileSync`, `existsSync`, `join`):

```ts
  describe("memory files", () => {
    it("pulls a Hub-only memory/*.md into the local memory/ dir (creating it)", async () => {
      const api = makeApi({
        getManifest: vi.fn(async () => ({
          ok: true,
          data: [{ filename: "memory/notes.md", hash: "mh1", size: 3, updated_at: "t" }],
        })),
        pull: vi.fn(async () => "mem-body"),
      });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      const dest = join(localDir, "memory", "notes.md");
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf8")).toBe("mem-body");
      expect(state.get(1, "memory/notes.md")).toBe("mh1");
    });

    it("pushes a local-only memory/*.md keyed memory/<name>", async () => {
      mkdirSync(join(localDir, "memory"), { recursive: true });
      writeFileSync(join(localDir, "memory", "notes.md"), "local-mem", "utf8");
      const push = vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "mh2" } }));
      const api = makeApi({ push });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(push).toHaveBeenCalledWith(1, "memory/notes.md", "local-mem", null);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agent && pnpm exec vitest run src/reconcile.test.ts`
Expected: FAIL — `localFiles` doesn't scan `memory/`, and the Hub-only pull writes without creating `memory/`, so the pull test's `writeFile` throws (ENOENT) and the push test never sees the local file.

- [ ] **Step 3: Implement the reconcile changes**

In `apps/agent/src/reconcile.ts`:

(a) Replace the whole `localFiles` function with a shared collector that scans both the top-level `*.jsonl` and `memory/*.md`:

```ts
/** Read every `*<ext>` file directly in `dir`, keyed `${keyPrefix}${name}`. */
async function collectInto(
  dir: string,
  keyPrefix: string,
  ext: string,
  out: Record<string, LocalFile>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Missing/unreadable directory (e.g. no memory/ subfolder) — skip it.
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(ext)) continue;
    try {
      const content = await readFile(join(dir, entry.name), "utf8");
      out[`${keyPrefix}${entry.name}`] = { content, hash: hashContent(content) };
    } catch {
      // Unreadable file (permissions, mid-write, ...) — skip it.
    }
  }
}

/** Read this project's synced files: top-level `*.jsonl` and `memory/*.md`. */
async function localFiles(dir: string): Promise<Record<string, LocalFile>> {
  const out: Record<string, LocalFile> = {};
  await collectInto(dir, "", ".jsonl", out);
  await collectInto(join(dir, "memory"), "memory/", ".md", out);
  return out;
}
```

(b) Add this helper just above `pushLocal`:

```ts
/** Create the parent dir of `filename` under `localPath` when it is nested
 *  (e.g. `memory/foo.md`). No-op for a plain top-level basename. */
async function ensureParentDir(localPath: string, filename: string): Promise<void> {
  const slash = filename.lastIndexOf("/");
  if (slash === -1) return;
  await mkdir(join(localPath, filename.slice(0, slash)), { recursive: true });
}
```

(c) In `pushLocal`, in the `case "merged": case "behind":` block, add the `ensureParentDir` call immediately before `writeFile`:

```ts
        const merged = await api.pull(projectId, filename);
        if (merged != null) {
          await ensureParentDir(localPath, filename);
          await writeFile(join(localPath, filename), merged);
          if (d.hash) state.set(projectId, filename, d.hash);
          log(`${d.status} ${filename}`);
          if (d.status === "merged") notify("SyncHub — auto-merged", filename);
        }
```

(d) In `reconcileProject`, in the `if (hub && !loc)` (Hub-only) branch, add the `ensureParentDir` call immediately before `writeFile`:

```ts
      if (hub && !loc) {
        const content = await api.pull(projectId, filename);
        if (content != null) {
          await ensureParentDir(localPath, filename);
          await writeFile(join(localPath, filename), content);
          state.set(projectId, filename, hub.hash);
          log(`pulled ${filename}`);
        }
      } else if (loc && !hub) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agent && pnpm exec vitest run src/reconcile.test.ts`
Expected: PASS — new memory tests plus all existing reconcile tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/reconcile.ts apps/agent/src/reconcile.test.ts
git commit -m "feat(agent): reconcile memory/*.md (scan, pull, mkdir)"
```

---

### Task 5: Merge coverage — prove markdown conflict/forward behavior

No production code changes. This locks in the behavior the design depends on:
`autoMerge` never silently mangles a divergent markdown edit — it conflicts.

**Files:**
- Test: `apps/hub-api/src/sync/merge.service.test.ts`

- [ ] **Step 1: Write the tests**

Add inside the `describe("MergeService#autoMerge", …)` block in `apps/hub-api/src/sync/merge.service.test.ts` (reuses the file's existing `svc` instance):

```ts
  it("divergent in-place markdown edits are a conflict, not a silent merge", () => {
    const canonical = "# Memory\n- fact one\n- fact two\n";
    const incoming = "# Memory\n- fact one\n- fact two (edited)\n";
    expect(svc.autoMerge(canonical, incoming).kind).toBe("conflict");
  });

  it("appending to a markdown file is a clean forward", () => {
    const canonical = "# Memory\n- fact one\n";
    const incoming = "# Memory\n- fact one\n- fact two\n";
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("forward");
    expect(m.merged).toBe(incoming);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/hub-api && pnpm exec vitest run src/sync/merge.service.test.ts`
Expected: PASS immediately (documents existing behavior — no production change).

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/sync/merge.service.test.ts
git commit -m "test(hub-api): cover markdown conflict/forward in autoMerge"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Agent — full test suite + typecheck**

Run: `cd apps/agent && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 2: Hub — full test suite + typecheck**

Run: `cd apps/hub-api && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 3: Post-deploy manual check (record, do not block the merge)**

After the Hub + agent are deployed, on a machine with a mapped project that has
a `memory/` folder: edit `memory/MEMORY.md`, confirm it appears in the Hub, then
on a second machine confirm it pulls into `memory/MEMORY.md`. This specifically
exercises the `%2F` pull path through the Coolify/Traefik proxy (verified at the
Express layer during planning; the proxy is the one layer not testable locally).
If the pull 404s at the proxy, follow-up: switch `GET pull/:projectId/:filename`
to a query parameter (`?filename=`) in both `sync.controller.ts` and `api.ts`.

- [ ] **Step 4: No commit** (verification only).

---

## Notes / accepted trade-offs

- **Watcher watches all depth-1 subfolders.** `depth: 1` means chokidar also
  watches files inside sibling session subfolders; `relSyncName` filters every
  non-`memory/*.md` event out cheaply. Accepted per spec — simpler than a custom
  `ignored` predicate, and correctness is unaffected.
- **No Hub schema/endpoint/merge change.** Memory files are opaque `filename`
  strings end to end; the whole feature is agent-side plus the mirrored guard.
