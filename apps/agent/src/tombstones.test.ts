import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("./atomic.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atomic.js")>();
  return {
    ...actual,
    writeFileAtomic: vi.fn(actual.writeFileAtomic),
  };
});

import { createTombstones } from "./tombstones.js";
import { writeFileAtomic } from "./atomic.js";

const mockedWrite = vi.mocked(writeFileAtomic);
const TEST_DIR = join(tmpdir(), "synchub-agent-tombstones-test");

describe("tombstones", () => {
  let tombstoneFile: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    tombstoneFile = join(TEST_DIR, `tombstones-${counter}.json`);
    mockedWrite.mockClear();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("has returns false for anything when the file is missing", () => {
    const store = createTombstones(tombstoneFile);
    expect(store.has("1/a.jsonl")).toBe(false);
    expect(store.list()).toEqual([]);
    store.close();
  });

  it("add then has round-trips; unknown keys stay false", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");
    expect(store.has("1/a.jsonl")).toBe(true);
    expect(store.has("1/b.jsonl")).toBe(false);
    store.close();
  });

  it("delete removes an entry", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");
    store.delete("1/a.jsonl");
    expect(store.has("1/a.jsonl")).toBe(false);
    store.close();
  });

  it("persists across a reload: a fresh createTombstones from the same path sees the key", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");
    store.flush();

    const reloaded = createTombstones(tombstoneFile);
    expect(reloaded.has("1/a.jsonl")).toBe(true);

    reloaded.close();
    store.close();
  });

  it("close() flushes pending changes so a fresh createTombstones reads them back", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");
    store.close();

    const reloaded = createTombstones(tombstoneFile);
    expect(reloaded.has("1/a.jsonl")).toBe(true);
    reloaded.close();
  });

  it("createTombstones on a corrupt tombstone file returns an empty store without throwing", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(tombstoneFile, "{ bad");

    let store: ReturnType<typeof createTombstones> | undefined;
    expect(() => {
      store = createTombstones(tombstoneFile);
    }).not.toThrow();

    expect(store!.has("1/a.jsonl")).toBe(false);
    expect(store!.list()).toEqual([]);
    store!.close();
  });

  it.each(["null", "42", '"a string"', "{}", '[1, 2, 3]', '["ok", 5]'])(
    "createTombstones on a tombstone file containing %s (valid JSON, wrong shape) returns an empty store, and add() does not throw",
    (content) => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(tombstoneFile, content);

      let store: ReturnType<typeof createTombstones> | undefined;
      expect(() => {
        store = createTombstones(tombstoneFile);
      }).not.toThrow();

      expect(store!.has("1/a.jsonl")).toBe(false);

      expect(() => store!.add("1/a.jsonl")).not.toThrow();
      expect(store!.has("1/a.jsonl")).toBe(true);

      store!.close();
    },
  );

  it("list returns all current keys", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");
    store.add("2/b.jsonl");
    expect(store.list().sort()).toEqual(["1/a.jsonl", "2/b.jsonl"]);
    store.close();
  });

  it("writes go through writeFileAtomic and the file round-trips as a JSON array on disk", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");
    store.flush();

    expect(mockedWrite).toHaveBeenCalled();
    expect(existsSync(tombstoneFile)).toBe(true);
    const onDisk: unknown = JSON.parse(readFileSync(tombstoneFile, "utf8"));
    expect(onDisk).toEqual(["1/a.jsonl"]);

    store.close();
  });
});

describe("tombstones batched persistence", () => {
  let tombstoneFile: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    tombstoneFile = join(TEST_DIR, `batched-${counter}.json`);
    mockedWrite.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("rapid add() calls do not write synchronously; flush() triggers exactly one write", () => {
    const store = createTombstones(tombstoneFile);

    store.add("1/a.jsonl");
    store.add("1/b.jsonl");
    store.add("2/c.jsonl");
    expect(mockedWrite).not.toHaveBeenCalled();

    store.flush();
    expect(mockedWrite).toHaveBeenCalledTimes(1);

    const persisted = JSON.parse(mockedWrite.mock.calls[0]![1] as string) as string[];
    expect(persisted.sort()).toEqual(["1/a.jsonl", "1/b.jsonl", "2/c.jsonl"]);

    store.close();
  });

  it("debounce timer fires exactly one write after multiple rapid mutations, with no explicit flush", () => {
    const store = createTombstones(tombstoneFile);

    store.add("1/a.jsonl");
    store.add("1/b.jsonl");
    store.delete("1/a.jsonl");
    expect(mockedWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(mockedWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockedWrite).toHaveBeenCalledTimes(1);

    store.close();
  });

  it("close() after an add() flushes pending changes exactly once and clears the timer", () => {
    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");

    store.close();
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

    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");

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
    store.add("2/b.jsonl");
    vi.advanceTimersByTime(200);
    expect(mockedWrite).toHaveBeenCalledTimes(2);

    const reloaded = createTombstones(tombstoneFile);
    expect(reloaded.has("1/a.jsonl")).toBe(true);
    expect(reloaded.has("2/b.jsonl")).toBe(true);
    reloaded.close();

    store.close();
    consoleErrorSpy.mockRestore();
  });

  it("close() swallows a writeFileAtomic failure rather than throwing out of the shutdown path", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedWrite.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const store = createTombstones(tombstoneFile);
    store.add("1/a.jsonl");

    expect(() => store.close()).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
