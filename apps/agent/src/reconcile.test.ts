import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Track every fs/promises.readFile call (pass-through, behaviour unchanged) so
// we can assert reconcile does NOT slurp a file's full content unless it must
// push it — that whole-content read, done for every file at once, was the
// heap-spike OOM (crash 0x8007042B). Streaming hashes must not trip this.
const { readFileSpy } = vi.hoisted(() => ({ readFileSpy: vi.fn() }));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (path: unknown, ...rest: unknown[]) => {
      readFileSpy(path);
      return (actual.readFile as (...a: unknown[]) => unknown)(path, ...rest);
    },
  };
});

import { createState } from "./state.js";
import { createTombstones, type TombstoneStore } from "./tombstones.js";
import { hashContent } from "./hasher.js";
import type { Api } from "./api.js";
import type { AgentMapping, ManifestEntry } from "@synchub/shared";
import { pushLocal, reconcileProject, reconcileAll, type ReconcileDeps } from "./reconcile.js";

const TEST_ROOT = join(tmpdir(), "synchub-agent-reconcile-test");

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    getMappings: vi.fn(async () => ({ ok: true, data: [] })),
    getManifest: vi.fn(async () => ({ ok: true, data: [] })),
    pull: vi.fn(async () => null),
    push: vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "h" } })),
    ...overrides,
  } as unknown as Api;
}

describe("reconcile", () => {
  let counter = 0;
  let localDir: string;
  let stateFile: string;
  let tombstoneFile: string;
  let state: ReturnType<typeof createState>;
  let tombstones: TombstoneStore;
  let log: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    counter += 1;
    localDir = join(TEST_ROOT, `local-${counter}`);
    stateFile = join(TEST_ROOT, `state-${counter}.json`);
    tombstoneFile = join(TEST_ROOT, `tombstones-${counter}.json`);
    mkdirSync(TEST_ROOT, { recursive: true });
    state = createState(stateFile);
    tombstones = createTombstones(tombstoneFile);
    log = vi.fn();
    notify = vi.fn();
  });

  afterEach(() => {
    state.close();
    tombstones.close();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  function deps(api: Api, extra: Partial<ReconcileDeps> = {}): ReconcileDeps {
    return { api, state, tombstones, log, notify, ...extra };
  }

  describe("pushLocal state machine", () => {
    it("accepted: sets state and logs 'pushed'", async () => {
      const api = makeApi({
        push: vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "hash-accepted" } })),
      });
      await pushLocal(deps(api), 1, localDir, "a.jsonl", "content", null);

      expect(state.get(1, "a.jsonl")).toBe("hash-accepted");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("pushed"));
    });

    it("unchanged: sets state, no throw", async () => {
      const api = makeApi({
        push: vi.fn(async () => ({ ok: true, data: { status: "unchanged", hash: "hash-unchanged" } })),
      });
      await pushLocal(deps(api), 1, localDir, "a.jsonl", "content", "hash-unchanged");

      expect(state.get(1, "a.jsonl")).toBe("hash-unchanged");
    });

    it("unauthorized: surfaces an onUnauthorized signal, no throw", async () => {
      const api = makeApi({
        push: vi.fn(async () => ({ ok: false, kind: "unauthorized" })),
      });
      const onUnauthorized = vi.fn();
      await expect(
        pushLocal(deps(api, { onUnauthorized }), 1, localDir, "a.jsonl", "content", null),
      ).resolves.not.toThrow();

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(state.get(1, "a.jsonl")).toBeNull();
    });

    it.each(["http", "network", "parse"] as const)("%s failure: logged + skipped, no throw", async (kind) => {
      const api = makeApi({
        push: vi.fn(async () => ({ ok: false, kind, status: kind === "http" ? 500 : undefined })),
      });
      await expect(pushLocal(deps(api), 1, localDir, "a.jsonl", "content", null)).resolves.not.toThrow();

      expect(state.get(1, "a.jsonl")).toBeNull();
      expect(log).toHaveBeenCalled();
    });
  });

  describe("reconcileProject", () => {
    it("hub-only file: pulls, writes locally, sets state", async () => {
      const manifest: ManifestEntry[] = [
        { filename: "hub-only.jsonl", hash: "hub-hash", size: 10, updated_at: "2026-01-01" },
      ];
      const api = makeApi({
        getManifest: vi.fn(async () => ({ ok: true, data: manifest })),
        pull: vi.fn(async () => "hub-content"),
      });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(readFileSync(join(localDir, "hub-only.jsonl"), "utf8")).toBe("hub-content");
      expect(state.get(1, "hub-only.jsonl")).toBe("hub-hash");
    });

    it("local-only file: pushes with baseHash null", async () => {
      mkdirSync(localDir, { recursive: true });
      writeFileSync(join(localDir, "local-only.jsonl"), "local-content");
      const push = vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "pushed-hash" } }));
      const api = makeApi({
        getManifest: vi.fn(async () => ({ ok: true, data: [] })),
        push,
      });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(push).toHaveBeenCalledWith(1, "local-only.jsonl", "local-content", null);
      expect(state.get(1, "local-only.jsonl")).toBe("pushed-hash");
    });

    it("both same hash: sets state only, no push/pull", async () => {
      mkdirSync(localDir, { recursive: true });
      const content = "same-content";
      const hash = hashContent(content);
      writeFileSync(join(localDir, "same.jsonl"), content);
      const manifest: ManifestEntry[] = [{ filename: "same.jsonl", hash, size: content.length, updated_at: "x" }];
      const push = vi.fn();
      const pull = vi.fn();
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })), push, pull });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(push).not.toHaveBeenCalled();
      expect(pull).not.toHaveBeenCalled();
      expect(state.get(1, "same.jsonl")).toBe(hash);
    });

    it("memory: a file whose hash matches the Hub is streamed, not slurped into memory", async () => {
      mkdirSync(localDir, { recursive: true });
      const content = "matching-content";
      const hash = hashContent(content);
      writeFileSync(join(localDir, "same.jsonl"), content);
      const manifest: ManifestEntry[] = [
        { filename: "same.jsonl", hash, size: content.length, updated_at: "x" },
      ];
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })) });
      readFileSpy.mockClear();

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      // Old impl read the whole file (to hash it) via readFile; the fix hashes
      // by streaming and only reads full content when a push is required —
      // which this matching file does not need.
      expect(readFileSpy).not.toHaveBeenCalledWith(join(localDir, "same.jsonl"));
    });

    it("both differ: pushes with baseHash = state.get()", async () => {
      mkdirSync(localDir, { recursive: true });
      const localContent = "local-version";
      writeFileSync(join(localDir, "diff.jsonl"), localContent);
      state.set(1, "diff.jsonl", "previous-base-hash");
      const manifest: ManifestEntry[] = [
        { filename: "diff.jsonl", hash: "hub-hash-different", size: 5, updated_at: "x" },
      ];
      const push = vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "new-hash" } }));
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })), push });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(push).toHaveBeenCalledWith(1, "diff.jsonl", localContent, "previous-base-hash");
    });

    it("both differ but local unchanged since last sync (base===local): pulls canonical, overwrites local, does not push", async () => {
      mkdirSync(localDir, { recursive: true });
      const localContent = "local-equals-base";
      writeFileSync(join(localDir, "conv.jsonl"), localContent, "utf8");
      // state === hash of the local file => local hasn't changed since we last
      // synced it; the divergence is because canonical moved on (another
      // machine's push, or a conflict resolved to a different version).
      state.set(1, "conv.jsonl", hashContent(localContent));
      const manifest: ManifestEntry[] = [
        { filename: "conv.jsonl", hash: "hub-hash-advanced", size: 5, updated_at: "x" },
      ];
      const push = vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "should-not-happen" } }));
      const pull = vi.fn(async () => "canonical-advanced-content");
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })), push, pull });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      // Canonical wins: pull + overwrite, never re-push a stale-but-unchanged
      // copy (which for a non-append file would just reopen the conflict).
      expect(push).not.toHaveBeenCalled();
      expect(pull).toHaveBeenCalledWith(1, "conv.jsonl");
      expect(readFileSync(join(localDir, "conv.jsonl"), "utf8")).toBe("canonical-advanced-content");
      expect(state.get(1, "conv.jsonl")).toBe("hub-hash-advanced");
    });

    it("tombstoned hub file: does not pull/write it, and re-attempts the hub delete", async () => {
      const manifest: ManifestEntry[] = [
        { filename: "deleted.jsonl", hash: "hub-hash", size: 10, updated_at: "x" },
      ];
      const pull = vi.fn(async () => "should-not-be-written");
      const deleteFile = vi.fn(async () => ({ ok: true, data: { status: "deleted" } }));
      const api = makeApi({
        getManifest: vi.fn(async () => ({ ok: true, data: manifest })),
        pull,
        deleteFile,
      });
      tombstones.add("1/deleted.jsonl");

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(pull).not.toHaveBeenCalled();
      expect(existsSync(join(localDir, "deleted.jsonl"))).toBe(false);
      expect(deleteFile).toHaveBeenCalledWith(1, "deleted.jsonl");
      // Still tombstoned: the Hub delete was only just re-attempted, not
      // yet confirmed by a fresh manifest that no longer lists the file.
      expect(tombstones.has("1/deleted.jsonl")).toBe(true);
    });

    it("tombstoned file no longer on the Hub: prunes the tombstone and writes nothing", async () => {
      const pull = vi.fn(async () => "should-not-be-written");
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: [] })), pull });
      tombstones.add("1/deleted.jsonl");

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(pull).not.toHaveBeenCalled();
      expect(existsSync(join(localDir, "deleted.jsonl"))).toBe(false);
      expect(tombstones.has("1/deleted.jsonl")).toBe(false);
    });

    it("after a tombstone is pruned, a fresh manifest entry with that same filename (no tombstone) is pulled normally", async () => {
      // First pass: hub no longer lists it -> tombstone gets pruned.
      const api1 = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: [] })) });
      tombstones.add("1/recreated.jsonl");
      await reconcileProject(deps(api1), { projectId: 1, localPath: localDir });
      expect(tombstones.has("1/recreated.jsonl")).toBe(false);

      // Second pass: a legitimately re-created same-named file now on the Hub.
      const manifest: ManifestEntry[] = [
        { filename: "recreated.jsonl", hash: "new-hub-hash", size: 3, updated_at: "y" },
      ];
      const pull = vi.fn(async () => "brand-new-content");
      const api2 = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })), pull });

      await reconcileProject(deps(api2), { projectId: 1, localPath: localDir });

      expect(pull).toHaveBeenCalledWith(1, "recreated.jsonl");
      expect(readFileSync(join(localDir, "recreated.jsonl"), "utf8")).toBe("brand-new-content");
      expect(state.get(1, "recreated.jsonl")).toBe("new-hub-hash");
    });

    it("tombstone cleared by a local recreate: reconcileProject treats it as a normal local-only file (no deleteFile re-attempt)", async () => {
      mkdirSync(localDir, { recursive: true });
      writeFileSync(join(localDir, "recreated.jsonl"), "new-local-content");
      // Simulate the watcher's fix: it tombstoned the file on unlink, then
      // cleared the tombstone itself when the same filename was recreated
      // locally — by the time reconcile runs, there's no tombstone left.
      tombstones.add("1/recreated.jsonl");
      tombstones.delete("1/recreated.jsonl");

      const deleteFile = vi.fn(async () => ({ ok: true, data: { status: "deleted" } }));
      const push = vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "new-hash" } }));
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: [] })), deleteFile, push });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(deleteFile).not.toHaveBeenCalled();
      expect(push).toHaveBeenCalledWith(1, "recreated.jsonl", "new-local-content", null);
    });

    it("manifest entry with an unsafe (path-traversal) filename is skipped: no writeFile", async () => {
      const manifest: ManifestEntry[] = [
        { filename: "../evil.jsonl", hash: "hub-hash", size: 10, updated_at: "x" },
      ];
      const pull = vi.fn(async () => "should-not-be-written");
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })), pull });

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(pull).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/unsafe|traversal|skip/i));
      // Must not have escaped localDir either.
      expect(existsSync(join(TEST_ROOT, "evil.jsonl"))).toBe(false);
    });

    it("getManifest failure: skips the project, no throw, no partial corruption", async () => {
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: false, kind: "http", status: 500 })) });

      await expect(reconcileProject(deps(api), { projectId: 1, localPath: localDir })).resolves.not.toThrow();
      expect(log).toHaveBeenCalled();
    });

    it("getManifest unauthorized: surfaces onUnauthorized", async () => {
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: false, kind: "unauthorized" })) });
      const onUnauthorized = vi.fn();

      await expect(
        reconcileProject(deps(api, { onUnauthorized }), { projectId: 1, localPath: localDir }),
      ).resolves.not.toThrow();

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconcileAll", () => {
    function mapping(over: Partial<AgentMapping>): AgentMapping {
      return {
        project_id: 1,
        machine_id: 1,
        local_path: join(TEST_ROOT, `mapping-${counter}-${over.project_id ?? 1}`),
        alias: null,
        sync_mode: "auto",
        ...over,
      };
    }

    it("trigger 'auto': only sync_mode==='auto' projects are reconciled", async () => {
      const mappings = [
        mapping({ project_id: 1, sync_mode: "auto" }),
        mapping({ project_id: 2, sync_mode: "manual" }),
        mapping({ project_id: 3, sync_mode: "stopped" }),
      ];
      const getManifest = vi.fn(async () => ({ ok: true, data: [] }));
      const api = makeApi({
        getMappings: vi.fn(async () => ({ ok: true, data: mappings })),
        getManifest,
      });

      await reconcileAll(deps(api), { trigger: "auto" });

      expect(getManifest).toHaveBeenCalledTimes(1);
      expect(getManifest).toHaveBeenCalledWith(1);
    });

    it("trigger 'manual-project': reconciles that project even if sync_mode is 'manual'", async () => {
      const mappings = [
        mapping({ project_id: 1, sync_mode: "auto" }),
        mapping({ project_id: 2, sync_mode: "manual" }),
      ];
      const getManifest = vi.fn(async () => ({ ok: true, data: [] }));
      const api = makeApi({
        getMappings: vi.fn(async () => ({ ok: true, data: mappings })),
        getManifest,
      });

      await reconcileAll(deps(api), { trigger: "manual-project", projectId: 2 });

      expect(getManifest).toHaveBeenCalledTimes(1);
      expect(getManifest).toHaveBeenCalledWith(2);
    });

    it("trigger 'manual-project': does not reconcile if sync_mode is 'stopped'", async () => {
      const mappings = [mapping({ project_id: 3, sync_mode: "stopped" })];
      const getManifest = vi.fn(async () => ({ ok: true, data: [] }));
      const api = makeApi({
        getMappings: vi.fn(async () => ({ ok: true, data: mappings })),
        getManifest,
      });

      await reconcileAll(deps(api), { trigger: "manual-project", projectId: 3 });

      expect(getManifest).not.toHaveBeenCalled();
    });

    it("getMappings failure: returns gracefully, no throw", async () => {
      const api = makeApi({ getMappings: vi.fn(async () => ({ ok: false, kind: "network" })) });

      await expect(reconcileAll(deps(api), { trigger: "auto" })).resolves.not.toThrow();
      expect(log).toHaveBeenCalled();
    });

    it("getMappings unauthorized: surfaces onUnauthorized", async () => {
      const api = makeApi({ getMappings: vi.fn(async () => ({ ok: false, kind: "unauthorized" })) });
      const onUnauthorized = vi.fn();

      await expect(
        reconcileAll(deps(api, { onUnauthorized }), { trigger: "auto" }),
      ).resolves.not.toThrow();

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
  });

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
});
