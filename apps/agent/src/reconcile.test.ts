import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createState } from "./state.js";
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
  let state: ReturnType<typeof createState>;
  let tombstones: Set<string>;
  let log: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    counter += 1;
    localDir = join(TEST_ROOT, `local-${counter}`);
    stateFile = join(TEST_ROOT, `state-${counter}.json`);
    mkdirSync(TEST_ROOT, { recursive: true });
    state = createState(stateFile);
    tombstones = new Set();
    log = vi.fn();
    notify = vi.fn();
  });

  afterEach(() => {
    state.close();
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

    it("merged: pulls merged content, overwrites local file, sets state, notifies", async () => {
      mkdirSync(localDir, { recursive: true });
      const api = makeApi({
        push: vi.fn(async () => ({ ok: true, data: { status: "merged", hash: "hash-merged" } })),
        pull: vi.fn(async () => "merged-content"),
      });
      await pushLocal(deps(api), 1, localDir, "a.jsonl", "local-content", "base-hash");

      expect(api.pull).toHaveBeenCalledWith(1, "a.jsonl");
      expect(readFileSync(join(localDir, "a.jsonl"), "utf8")).toBe("merged-content");
      expect(state.get(1, "a.jsonl")).toBe("hash-merged");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("merged"), "a.jsonl");
    });

    it("behind: pulls canonical content, overwrites local file, sets state", async () => {
      mkdirSync(localDir, { recursive: true });
      const api = makeApi({
        push: vi.fn(async () => ({ ok: true, data: { status: "behind", hash: "hash-behind" } })),
        pull: vi.fn(async () => "canonical-content"),
      });
      await pushLocal(deps(api), 1, localDir, "a.jsonl", "local-content", "base-hash");

      expect(api.pull).toHaveBeenCalledWith(1, "a.jsonl");
      expect(readFileSync(join(localDir, "a.jsonl"), "utf8")).toBe("canonical-content");
      expect(state.get(1, "a.jsonl")).toBe("hash-behind");
    });

    it("conflict: logs + notifies to resolve in Hub, no state change", async () => {
      const api = makeApi({
        push: vi.fn(async () => ({ ok: true, data: { status: "conflict", conflictId: 42 } })),
      });
      await pushLocal(deps(api), 1, localDir, "a.jsonl", "local-content", "base-hash");

      expect(state.get(1, "a.jsonl")).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/conflict/i));
      expect(notify).toHaveBeenCalledWith(expect.stringMatching(/conflict/i), expect.stringMatching(/manual resolution/i));
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

    it("tombstoned hub file: does not pull/write it (resurrection prevented)", async () => {
      const manifest: ManifestEntry[] = [
        { filename: "deleted.jsonl", hash: "hub-hash", size: 10, updated_at: "x" },
      ];
      const pull = vi.fn(async () => "should-not-be-written");
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: true, data: manifest })), pull });
      tombstones.add("1/deleted.jsonl");

      await reconcileProject(deps(api), { projectId: 1, localPath: localDir });

      expect(pull).not.toHaveBeenCalled();
      expect(existsSync(join(localDir, "deleted.jsonl"))).toBe(false);
    });

    it("getManifest failure: skips the project, no throw, no partial corruption", async () => {
      const api = makeApi({ getManifest: vi.fn(async () => ({ ok: false, kind: "http", status: 500 })) });

      await expect(reconcileProject(deps(api), { projectId: 1, localPath: localDir })).resolves.not.toThrow();
      expect(log).toHaveBeenCalled();
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
  });
});
