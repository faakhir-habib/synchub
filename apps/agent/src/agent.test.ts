import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AgentMapping } from "@synchub/shared";
import type { Api } from "./api.js";
import type { AgentState } from "./state.js";
import type { AgentConfig } from "./config.js";
import { SyncQueue } from "./sync-queue.js";
import { runAgent } from "./agent.js";
import type { WsFactory, WsLike } from "./ws.js";
import type { WatcherFactory, WatchHandle } from "./watcher.js";

const TEST_ROOT = join(tmpdir(), "synchub-agent-agent-test");

/** A fake WebSocket-like object whose event handlers we can invoke manually. */
function makeFakeWs(): WsLike & { emit(event: string, ...args: unknown[]): void; close: ReturnType<typeof vi.fn> } {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const closeSpy = vi.fn();
  const fake = {
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
      return fake;
    },
    close: closeSpy,
    emit(event: string, ...args: unknown[]): void {
      for (const cb of handlers.get(event) ?? []) cb(...args);
    },
  };
  return fake;
}

/** A fake FSWatcher-like object — we don't need to fire its events in agent.test, just track creation/close. */
function makeFakeWatcher(): WatchHandle & { close: ReturnType<typeof vi.fn> } {
  return {
    on: vi.fn(),
    close: vi.fn(async () => {}),
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

const cfg: AgentConfig = { hubUrl: "http://hub", machineToken: "tok", machineId: 1 };

describe("runAgent", () => {
  let counter = 0;
  let log: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    counter += 1;
    log = vi.fn();
    notify = vi.fn();
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    vi.useRealTimers();
  });

  function tmpDir(): string {
    const dir = join(TEST_ROOT, `local-${counter}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("boot: enqueues an auto-trigger reconcile:all, starts the watcher, and connects ws", async () => {
    const dir = tmpDir();
    const m = mapping({ project_id: 1, local_path: dir, sync_mode: "auto" });
    const api = makeApi({
      getMappings: vi.fn(async () => ({ ok: true, data: [m] })),
      getManifest: vi.fn(async () => ({ ok: true, data: [] })),
    });
    const state = makeState();
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };
    const watchers: ReturnType<typeof makeFakeWatcher>[] = [];
    const watcherFactory: WatcherFactory = () => {
      const w = makeFakeWatcher();
      watchers.push(w);
      return w;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => state,
      watcherFactory,
      wsFactory,
    });

    await handle.whenIdle();

    // Boot reconcile:all reconciled the one auto project.
    expect(api.getManifest).toHaveBeenCalledWith(1);
    // Watcher started over current mappings.
    expect(watchers).toHaveLength(1);
    // WS connected.
    expect(sockets).toHaveLength(1);

    await handle.stop();
  });

  it("a changed message enqueues reconcileProject for that project (pulls the hub-only file)", async () => {
    const dir = tmpDir();
    const m = mapping({ project_id: 7, local_path: dir, sync_mode: "auto" });
    const api = makeApi({
      getMappings: vi.fn(async () => ({ ok: true, data: [m] })),
      getManifest: vi.fn(async () => ({
        ok: true,
        data: [{ filename: "a.jsonl", hash: "h1", size: 10, updated_at: "now" }],
      })),
      pull: vi.fn(async () => "hub-content"),
    });
    const state = makeState();
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => state,
      watcherFactory: () => makeFakeWatcher(),
      wsFactory,
    });

    await handle.whenIdle();
    api.getManifest.mockClear();

    sockets[0]!.emit("message", JSON.stringify({ type: "changed", projectId: 7, filename: "a.jsonl", hash: "h1" }));
    await handle.whenIdle();

    expect(api.getManifest).toHaveBeenCalledWith(7);
    expect(existsSync(join(dir, "a.jsonl"))).toBe(true);

    await handle.stop();
  });

  it("a changed message for an unmapped project is skipped (no crash, no enqueue work)", async () => {
    const api = makeApi({ getMappings: vi.fn(async () => ({ ok: true, data: [] })) });
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => makeState(),
      watcherFactory: () => makeFakeWatcher(),
      wsFactory,
    });

    await handle.whenIdle();
    api.getManifest.mockClear();

    sockets[0]!.emit(
      "message",
      JSON.stringify({ type: "changed", projectId: 999, filename: "a.jsonl", hash: "h1" }),
    );
    await handle.whenIdle();

    expect(api.getManifest).not.toHaveBeenCalled();

    await handle.stop();
  });

  it("a sync-trigger message reconciles that project even in manual mode (explicit trigger allowed)", async () => {
    const dir = tmpDir();
    const m = mapping({ project_id: 3, local_path: dir, sync_mode: "manual" });
    const api = makeApi({
      getMappings: vi.fn(async () => ({ ok: true, data: [m] })),
      getManifest: vi.fn(async () => ({ ok: true, data: [] })),
    });
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => makeState(),
      watcherFactory: () => makeFakeWatcher(),
      wsFactory,
    });

    await handle.whenIdle();
    // Boot ("auto" trigger) must NOT have reconciled the manual-mode project.
    expect(api.getManifest).not.toHaveBeenCalledWith(3);

    sockets[0]!.emit("message", JSON.stringify({ type: "sync-trigger", projectId: 3 }));
    await handle.whenIdle();

    expect(api.getManifest).toHaveBeenCalledWith(3);

    await handle.stop();
  });

  it("a deleted message unlinks the local file, clears state, and adds a tombstone", async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "gone.jsonl"), "bye");
    const m = mapping({ project_id: 5, local_path: dir, sync_mode: "auto" });
    const api = makeApi({ getMappings: vi.fn(async () => ({ ok: true, data: [m] })) });
    const state = makeState();
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => state,
      watcherFactory: () => makeFakeWatcher(),
      wsFactory,
    });

    await handle.whenIdle();
    expect(existsSync(join(dir, "gone.jsonl"))).toBe(true);

    sockets[0]!.emit("message", JSON.stringify({ type: "deleted", projectId: 5, filename: "gone.jsonl" }));
    await handle.whenIdle();

    expect(existsSync(join(dir, "gone.jsonl"))).toBe(false);
    expect(state.del).toHaveBeenCalledWith(5, "gone.jsonl");

    await handle.stop();
  });

  it("a deleted message with an unsafe (path-traversal) filename is skipped: no unlink, no state.del", async () => {
    const dir = tmpDir();
    const m = mapping({ project_id: 5, local_path: dir, sync_mode: "auto" });
    const api = makeApi({ getMappings: vi.fn(async () => ({ ok: true, data: [m] })) });
    const state = makeState();
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => state,
      watcherFactory: () => makeFakeWatcher(),
      wsFactory,
    });

    await handle.whenIdle();

    sockets[0]!.emit(
      "message",
      JSON.stringify({ type: "deleted", projectId: 5, filename: "../evil.jsonl" }),
    );
    await handle.whenIdle();

    expect(state.del).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/unsafe|traversal|skip/i));

    await handle.stop();
  });

  it("a ws (re)connect enqueues a fresh reconcile:all catch-up", async () => {
    const dir = tmpDir();
    const m = mapping({ project_id: 1, local_path: dir, sync_mode: "auto" });
    const api = makeApi({
      getMappings: vi.fn(async () => ({ ok: true, data: [m] })),
      getManifest: vi.fn(async () => ({ ok: true, data: [] })),
    });
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => makeState(),
      watcherFactory: () => makeFakeWatcher(),
      wsFactory,
    });

    await handle.whenIdle();
    const callsAfterBoot = api.getMappings.mock.calls.length;

    // Simulate a (re)connect firing 'open' again.
    sockets[0]!.emit("open");
    await handle.whenIdle();

    expect(api.getMappings.mock.calls.length).toBeGreaterThan(callsAfterBoot);

    await handle.stop();
  });

  it("the periodic tick enqueues reconcile:all and refreshes the watcher set when mappings changed", async () => {
    vi.useFakeTimers();
    try {
      const dirA = tmpDir();
      const dirB = tmpDir();
      const mA = mapping({ project_id: 1, local_path: dirA, sync_mode: "auto" });
      const mB = mapping({ project_id: 2, local_path: dirB, sync_mode: "auto" });
      let mappingsToReturn: AgentMapping[] = [mA];

      const api = makeApi({
        getMappings: vi.fn(async () => ({ ok: true, data: mappingsToReturn })),
        getManifest: vi.fn(async () => ({ ok: true, data: [] })),
      });
      const watchers: ReturnType<typeof makeFakeWatcher>[] = [];
      const watcherFactory: WatcherFactory = () => {
        const w = makeFakeWatcher();
        watchers.push(w);
        return w;
      };

      const handle = runAgent(cfg, {
        log,
        notify,
        apiFactory: () => api,
        stateFactory: () => makeState(),
        watcherFactory,
        wsFactory: () => makeFakeWs(),
        tickMs: 30000,
      });

      await handle.whenIdle();
      expect(watchers).toHaveLength(1);
      const getMappingsCallsBefore = api.getMappings.mock.calls.length;

      // Change what the next mappings fetch returns, then let the tick fire.
      mappingsToReturn = [mA, mB];
      await vi.advanceTimersByTimeAsync(30000);
      await handle.whenIdle();

      expect(api.getMappings.mock.calls.length).toBeGreaterThan(getMappingsCallsBefore);
      // Old watcher closed, new one created covering the changed mapping set.
      expect(watchers[0]!.close).toHaveBeenCalled();
      expect(watchers.length).toBeGreaterThan(1);

      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refresh the watcher when the tick's mappings fetch is unchanged", async () => {
    vi.useFakeTimers();
    try {
      const dir = tmpDir();
      const m = mapping({ project_id: 1, local_path: dir, sync_mode: "auto" });
      const api = makeApi({
        getMappings: vi.fn(async () => ({ ok: true, data: [m] })),
        getManifest: vi.fn(async () => ({ ok: true, data: [] })),
      });
      const watchers: ReturnType<typeof makeFakeWatcher>[] = [];
      const watcherFactory: WatcherFactory = () => {
        const w = makeFakeWatcher();
        watchers.push(w);
        return w;
      };

      const handle = runAgent(cfg, {
        log,
        notify,
        apiFactory: () => api,
        stateFactory: () => makeState(),
        watcherFactory,
        wsFactory: () => makeFakeWs(),
        tickMs: 30000,
      });

      await handle.whenIdle();
      expect(watchers).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30000);
      await handle.whenIdle();

      expect(watchers).toHaveLength(1);
      expect(watchers[0]!.close).not.toHaveBeenCalled();

      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs a re-pair message when the machine token is unauthorized during boot", async () => {
    const api = makeApi({
      getMappings: vi.fn(async () => ({ ok: false, kind: "unauthorized" })),
    });

    const handle = runAgent(cfg, {
      log,
      notify,
      apiFactory: () => api,
      stateFactory: () => makeState(),
      watcherFactory: () => makeFakeWatcher(),
      wsFactory: () => makeFakeWs(),
    });

    await handle.whenIdle();

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/re-?pair/i));

    await handle.stop();
  });

  it("stop() closes the ws, the watcher, drains+closes the queue, and closes state", async () => {
    const closeSpy = vi.spyOn(SyncQueue.prototype, "close");
    try {
      const dir = tmpDir();
      const m = mapping({ project_id: 1, local_path: dir, sync_mode: "auto" });
      const api = makeApi({
        getMappings: vi.fn(async () => ({ ok: true, data: [m] })),
        getManifest: vi.fn(async () => ({ ok: true, data: [] })),
      });
      const state = makeState();
      const sockets: ReturnType<typeof makeFakeWs>[] = [];
      const wsFactory: WsFactory = () => {
        const s = makeFakeWs();
        sockets.push(s);
        return s;
      };
      const watchers: ReturnType<typeof makeFakeWatcher>[] = [];
      const watcherFactory: WatcherFactory = () => {
        const w = makeFakeWatcher();
        watchers.push(w);
        return w;
      };

      const handle = runAgent(cfg, {
        log,
        notify,
        apiFactory: () => api,
        stateFactory: () => state,
        watcherFactory,
        wsFactory,
      });

      await handle.whenIdle();
      await handle.stop();

      expect(sockets[0]!.close).toHaveBeenCalledTimes(1);
      expect(watchers[0]!.close).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(state.close).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
    }
  });
});
