import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import type { AgentMapping } from "@synchub/shared";
import type { Api } from "./api.js";
import type { AgentState } from "./state.js";
import type { TombstoneStore } from "./tombstones.js";
import * as reconcileModule from "./reconcile.js";
import { watchProjects, type WatcherFactory } from "./watcher.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

/** A fake FSWatcher-like object whose event handlers we can invoke manually. */
function makeFakeWatcher() {
  const handlers = new Map<string, (path: string) => void>();
  const closeSpy = vi.fn(async () => {});
  return {
    on: vi.fn((event: string, cb: (path: string) => void) => {
      handlers.set(event, cb);
      return this;
    }),
    close: closeSpy,
    emit(event: string, path: string): void {
      const cb = handlers.get(event);
      if (!cb) throw new Error(`no handler registered for "${event}"`);
      cb(path);
    },
    hasHandler(event: string): boolean {
      return handlers.has(event);
    },
  };
}

function mapping(over: Partial<AgentMapping> = {}): AgentMapping {
  return {
    project_id: 1,
    machine_id: 1,
    local_path: "C:\\proj1",
    alias: "proj1",
    sync_mode: "auto",
    ...over,
  };
}

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    getMappings: vi.fn(async () => ({ ok: true, data: [] })),
    getManifest: vi.fn(async () => ({ ok: true, data: [] })),
    pull: vi.fn(async () => null),
    push: vi.fn(async () => ({ ok: true, data: { status: "accepted", hash: "h" } })),
    deleteFile: vi.fn(async () => ({ ok: true, data: { status: "deleted" } })),
    ...overrides,
  } as unknown as Api;
}

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    get: vi.fn(() => null),
    set: vi.fn(),
    del: vi.fn(),
    flush: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as AgentState;
}

/** A minimal in-memory TombstoneStore fake — persistence itself is covered by tombstones.test.ts. */
function makeTombstones(overrides: Partial<TombstoneStore> = {}): TombstoneStore {
  const set = new Set<string>();
  return {
    has: vi.fn((key: string) => set.has(key)),
    add: vi.fn((key: string) => {
      set.add(key);
    }),
    delete: vi.fn((key: string) => {
      set.delete(key);
    }),
    list: vi.fn(() => [...set]),
    flush: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as TombstoneStore;
}

describe("watchProjects", () => {
  let readFileMock: ReturnType<typeof vi.fn>;
  let pushLocalSpy: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockReset();
    pushLocalSpy = vi.spyOn(reconcileModule, "pushLocal").mockResolvedValue(undefined);
    log = vi.fn();
    notify = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    pushLocalSpy.mockRestore();
  });

  function makeQueue() {
    // A fake SyncQueue: records enqueue() calls, and lets the test run
    // a specific job on demand.
    const jobs = new Map<string, () => Promise<void>>();
    return {
      enqueue: vi.fn((key: string, task: () => Promise<void>) => {
        jobs.set(key, task);
      }),
      async run(key: string): Promise<void> {
        const job = jobs.get(key);
        if (!job) throw new Error(`no job enqueued for key "${key}"`);
        await job();
      },
      has(key: string): boolean {
        return jobs.has(key);
      },
      size(): number {
        return jobs.size;
      },
    };
  }

  it("only watches auto-mode mappings (manual/stopped get no watcher)", () => {
    const mappings = [
      mapping({ project_id: 1, sync_mode: "auto" }),
      mapping({ project_id: 2, sync_mode: "manual" }),
      mapping({ project_id: 3, sync_mode: "stopped" }),
    ];
    const created: ReturnType<typeof makeFakeWatcher>[] = [];
    const watcherFactory: WatcherFactory = () => {
      const w = makeFakeWatcher();
      created.push(w);
      return w;
    };

    const queue = makeQueue();
    const state = makeState();
    const handle = watchProjects(
      queue as never,
      makeApi(),
      state,
      makeTombstones(),
      mappings,
      { log, notify, watcherFactory },
    );

    expect(created).toHaveLength(1);
    handle.close();
  });

  it("debounces add/change on a .jsonl path and enqueues one push job with the right args", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const watcherFactory: WatcherFactory = () => watcher;
    const queue = makeQueue();
    const state = makeState({ get: vi.fn(() => "base-hash-123") });
    const api = makeApi();

    const handle = watchProjects(queue as never, api, state, makeTombstones(), [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory,
    });

    const path = join("C:\\proj1", "chat.jsonl");
    watcher.emit("change", path);

    // Not yet enqueued: debounce window hasn't elapsed.
    expect(queue.enqueue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.has("push:1/chat.jsonl")).toBe(true);

    readFileMock.mockResolvedValue("file-content");
    await queue.run("push:1/chat.jsonl");

    expect(readFileMock).toHaveBeenCalledWith(path, "utf8");
    expect(pushLocalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api, state }),
      1,
      "C:\\proj1",
      "chat.jsonl",
      "file-content",
      "base-hash-123",
    );

    handle.close();
  });

  it("clears an existing tombstone on a local add/change, before the push is enqueued (a recreated file un-tombstones itself)", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const state = makeState();
    const api = makeApi();
    const tombstones = makeTombstones();
    tombstones.add("1/chat.jsonl");

    const handle = watchProjects(queue as never, api, state, tombstones, [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    const path = join("C:\\proj1", "chat.jsonl");
    watcher.emit("change", path);

    // Still tombstoned immediately after the raw fs event — the clear
    // happens in the debounced handler, not synchronously at emit time.
    expect(tombstones.has("1/chat.jsonl")).toBe(true);

    await vi.advanceTimersByTimeAsync(300);

    // Cleared before/at the point the push job is enqueued.
    expect(tombstones.has("1/chat.jsonl")).toBe(false);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.has("push:1/chat.jsonl")).toBe(true);

    readFileMock.mockResolvedValue("recreated-content");
    await queue.run("push:1/chat.jsonl");

    expect(pushLocalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api, state }),
      1,
      "C:\\proj1",
      "chat.jsonl",
      "recreated-content",
      null,
    );

    handle.close();
  });

  it("coalesces rapid repeated changes to the same path into one enqueue, and the timer map is bounded (entry deleted after firing)", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const state = makeState();

    const handle = watchProjects(queue as never, makeApi(), state, makeTombstones(), [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    const path = join("C:\\proj1", "chat.jsonl");

    watcher.emit("change", path);
    await vi.advanceTimersByTimeAsync(100);
    watcher.emit("change", path);
    await vi.advanceTimersByTimeAsync(100);
    watcher.emit("change", path);
    await vi.advanceTimersByTimeAsync(100);
    // Total elapsed since the LAST change is only 100ms < 300ms debounce.
    expect(queue.enqueue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);

    // Map bounded: after firing, a fresh change re-creates a timer and
    // settles again to exactly one more enqueue (not a leak / stuck entry).
    readFileMock.mockResolvedValue("x");
    watcher.emit("change", path);
    await vi.advanceTimersByTimeAsync(300);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);

    handle.close();
  });

  it("unlink enqueues a delete job that calls api.deleteFile, state.del, and tombstones the file", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const state = makeState();
    const api = makeApi();
    const tombstones = makeTombstones();

    const handle = watchProjects(queue as never, api, state, tombstones, [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    const path = join("C:\\proj1", "chat.jsonl");
    watcher.emit("unlink", path);

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.has("delete:1/chat.jsonl")).toBe(true);

    await queue.run("delete:1/chat.jsonl");

    expect(api.deleteFile).toHaveBeenCalledWith(1, "chat.jsonl");
    expect(state.del).toHaveBeenCalledWith(1, "chat.jsonl");
    expect(tombstones.has("1/chat.jsonl")).toBe(true);

    handle.close();
  });

  it("unlink adds the tombstone EAGERLY — present immediately, before the enqueued delete job ever runs", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const state = makeState();
    const api = makeApi();
    const tombstones = makeTombstones();

    const handle = watchProjects(queue as never, api, state, tombstones, [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    const path = join("C:\\proj1", "chat.jsonl");
    watcher.emit("unlink", path);

    // The delete job has been enqueued but NOT run yet — the tombstone
    // must already be present, proving it was added synchronously at
    // unlink time rather than inside the job's async success path (so the
    // durable intent survives even if this job is later abandoned).
    expect(queue.has("delete:1/chat.jsonl")).toBe(true);
    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(tombstones.has("1/chat.jsonl")).toBe(true);

    handle.close();
  });

  it("ignores non-.jsonl paths on add/change/unlink", async () => {
    const m = mapping({ project_id: 1, local_path: "C:\\proj1" });
    const watcher = makeFakeWatcher();
    const queue = makeQueue();
    const state = makeState();

    const handle = watchProjects(queue as never, makeApi(), state, makeTombstones(), [m], {
      log,
      notify,
      debounceMs: 300,
      watcherFactory: () => watcher,
    });

    watcher.emit("change", join("C:\\proj1", "notes.txt"));
    watcher.emit("add", join("C:\\proj1", "readme.md"));
    watcher.emit("unlink", join("C:\\proj1", "notes.txt"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(queue.enqueue).not.toHaveBeenCalled();

    handle.close();
  });

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

  it("close() closes every created watcher and clears pending timers (no stale enqueue after close)", async () => {
    const mappings = [mapping({ project_id: 1 }), mapping({ project_id: 2, local_path: "C:\\proj2" })];
    const watchers: ReturnType<typeof makeFakeWatcher>[] = [];
    const watcherFactory: WatcherFactory = () => {
      const w = makeFakeWatcher();
      watchers.push(w);
      return w;
    };
    const queue = makeQueue();
    const state = makeState();

    const handle = watchProjects(queue as never, makeApi(), state, new Set(), mappings, {
      log,
      notify,
      debounceMs: 300,
      watcherFactory,
    });

    // Start a pending debounce timer, then close before it fires.
    watchers[0]!.emit("change", join("C:\\proj1", "chat.jsonl"));

    handle.close();

    expect(watchers).toHaveLength(2);
    for (const w of watchers) {
      expect(w.close).toHaveBeenCalledTimes(1);
    }

    // The pending timer must have been cleared: advancing time must not
    // trigger a stale enqueue after close().
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
