import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("./atomic.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atomic.js")>();
  return {
    ...actual,
    writeFileAtomic: vi.fn(actual.writeFileAtomic),
  };
});

import { createState } from "./state.js";
import { writeFileAtomic } from "./atomic.js";

const mockedWrite = vi.mocked(writeFileAtomic);
const TEST_DIR = join(tmpdir(), "synchub-agent-state-test");

describe("state", () => {
  let stateFile: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    stateFile = join(TEST_DIR, `state-${counter}.json`);
    mockedWrite.mockClear();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("get returns null for anything when the file is missing", () => {
    const state = createState(stateFile);
    expect(state.get(1, "a.jsonl")).toBeNull();
    expect(state.get(2, "z.jsonl")).toBeNull();
    state.close();
  });

  it("set then get round-trips; unknown keys stay null", () => {
    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");
    expect(state.get(1, "a.jsonl")).toBe("h1");
    expect(state.get(1, "b.jsonl")).toBeNull();
    state.close();
  });

  it("del removes an entry", () => {
    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");
    state.del(1, "a.jsonl");
    expect(state.get(1, "a.jsonl")).toBeNull();
    state.close();
  });

  it("createState on a corrupt state file returns an empty store without throwing", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(stateFile, "{ bad");

    let state: ReturnType<typeof createState> | undefined;
    expect(() => {
      state = createState(stateFile);
    }).not.toThrow();

    expect(state!.get(1, "a.jsonl")).toBeNull();
    state!.close();
  });

  it.each(["null", "42"])(
    "createState on a state file containing %s (valid JSON, wrong shape) returns an empty store, and set() does not throw",
    (content) => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(stateFile, content);

      let state: ReturnType<typeof createState> | undefined;
      expect(() => {
        state = createState(stateFile);
      }).not.toThrow();

      expect(state!.get(1, "a.jsonl")).toBeNull();

      expect(() => state!.set(1, "a.jsonl", "h1")).not.toThrow();
      expect(state!.get(1, "a.jsonl")).toBe("h1");

      state!.close();
    },
  );

  it("persists across an explicit flush and a fresh createState reads it back", () => {
    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");
    state.flush();

    const reloaded = createState(stateFile);
    expect(reloaded.get(1, "a.jsonl")).toBe("h1");

    reloaded.close();
    state.close();
  });

  it("close() flushes pending changes so a fresh createState reads them back", () => {
    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");
    state.close();

    const reloaded = createState(stateFile);
    expect(reloaded.get(1, "a.jsonl")).toBe("h1");
    reloaded.close();
  });
});

describe("state batched persistence", () => {
  let stateFile: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    stateFile = join(TEST_DIR, `batched-${counter}.json`);
    mockedWrite.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("rapid set() calls do not write synchronously; flush() triggers exactly one write", () => {
    const state = createState(stateFile);

    state.set(1, "a.jsonl", "h1");
    state.set(1, "b.jsonl", "h2");
    state.set(2, "c.jsonl", "h3");
    expect(mockedWrite).not.toHaveBeenCalled();

    state.flush();
    expect(mockedWrite).toHaveBeenCalledTimes(1);

    const persisted = JSON.parse(mockedWrite.mock.calls[0]![1] as string) as Record<
      string,
      string
    >;
    expect(persisted).toEqual({
      "1/a.jsonl": "h1",
      "1/b.jsonl": "h2",
      "2/c.jsonl": "h3",
    });

    state.close();
  });

  it("debounce timer fires exactly one write after multiple rapid sets, with no explicit flush", () => {
    const state = createState(stateFile);

    state.set(1, "a.jsonl", "h1");
    state.set(1, "a.jsonl", "h2");
    state.set(1, "b.jsonl", "h3");
    expect(mockedWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(mockedWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockedWrite).toHaveBeenCalledTimes(1);

    state.close();
  });

  it("close() after a set() flushes pending changes exactly once and clears the timer", () => {
    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");

    state.close();
    expect(mockedWrite).toHaveBeenCalledTimes(1);

    // If the debounce timer weren't cleared by close(), this would trigger
    // a second write once it fires.
    vi.advanceTimersByTime(1000);
    expect(mockedWrite).toHaveBeenCalledTimes(1);
  });

  it("a writeFileAtomic failure during the debounced flush does not throw/crash, logs via console.error, and keeps dirty so a later successful flush persists", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedWrite.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");

    // The debounced flush fires and writeFileAtomic throws internally —
    // this must not escape the timer callback.
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(mockedWrite).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("synchub"),
      expect.anything(),
    );

    // dirty must have been preserved (not cleared on failure): a later
    // mutation's debounced flush should retry the write, and this time it
    // succeeds, persisting to disk.
    state.set(1, "b.jsonl", "h2");
    vi.advanceTimersByTime(200);
    expect(mockedWrite).toHaveBeenCalledTimes(2);

    const reloaded = createState(stateFile);
    expect(reloaded.get(1, "a.jsonl")).toBe("h1");
    expect(reloaded.get(1, "b.jsonl")).toBe("h2");
    reloaded.close();

    state.close();
    consoleErrorSpy.mockRestore();
  });

  it("close() swallows a writeFileAtomic failure rather than throwing out of the shutdown path", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedWrite.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const state = createState(stateFile);
    state.set(1, "a.jsonl", "h1");

    expect(() => state.close()).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
