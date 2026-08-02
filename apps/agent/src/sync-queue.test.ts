import { describe, expect, it } from "vitest";

import { SyncQueue } from "./sync-queue.js";

/** A promise you can resolve/reject from outside, for deterministic ordering. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SyncQueue", () => {
  it("runs two enqueued tasks serially, never overlapping", async () => {
    const events: string[] = [];
    const gate1 = deferred();
    const gate2 = deferred();
    const queue = new SyncQueue();

    queue.enqueue("a", async () => {
      events.push("a-start");
      await gate1.promise;
      events.push("a-end");
    });
    queue.enqueue("b", async () => {
      events.push("b-start");
      await gate2.promise;
      events.push("b-end");
    });

    // Give the queue's microtask loop a chance to start task "a".
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["a-start"]);

    gate1.resolve();
    // Let "a" finish and the loop pick up "b".
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["a-start", "a-end", "b-start"]);

    gate2.resolve();
    await queue.close();
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("runs tasks with different keys in enqueue order", async () => {
    const order: string[] = [];
    const queue = new SyncQueue();

    queue.enqueue("x", async () => {
      order.push("x");
    });
    queue.enqueue("y", async () => {
      order.push("y");
    });
    queue.enqueue("z", async () => {
      order.push("z");
    });

    await queue.close();
    expect(order).toEqual(["x", "y", "z"]);
  });

  it("isolates a task error: reports via onError and keeps the queue running", async () => {
    const errors: Array<{ err: unknown; key: string }> = [];
    const ran: string[] = [];
    const boom = new Error("boom");
    const queue = new SyncQueue({
      onError: (err, key) => {
        errors.push({ err, key });
      },
    });

    queue.enqueue("fail", async () => {
      ran.push("fail");
      throw boom;
    });
    queue.enqueue("ok", async () => {
      ran.push("ok");
    });

    await queue.close();

    expect(ran).toEqual(["fail", "ok"]);
    expect(errors).toEqual([{ err: boom, key: "fail" }]);
  });

  it("coalesces a same-key enqueue burst while pending into a single invocation", async () => {
    const gate = deferred();
    let firstInvocations = 0;
    let otherRuns = 0;
    const queue = new SyncQueue();

    // Occupy the queue with a running "blocker" task so "k" stays pending.
    queue.enqueue("blocker", async () => {
      await gate.promise;
    });

    queue.enqueue("k", async () => {
      firstInvocations += 1;
    });
    // While "k" is pending (not yet running), re-enqueueing it must not add
    // a second pending entry.
    queue.enqueue("k", async () => {
      otherRuns += 1;
    });
    queue.enqueue("k", async () => {
      otherRuns += 1;
    });

    gate.resolve();
    await queue.close();

    expect(firstInvocations).toBe(1);
    expect(otherRuns).toBe(0);
  });

  it("re-runs a same-key task once if enqueued again while it is running", async () => {
    const gate = deferred();
    let runCount = 0;
    const queue = new SyncQueue();

    queue.enqueue("k", async () => {
      runCount += 1;
      if (runCount === 1) {
        await gate.promise;
      }
    });

    // Give the loop a tick to start the first run of "k".
    await Promise.resolve();
    await Promise.resolve();
    expect(runCount).toBe(1);

    // Same key enqueued repeatedly while "k" is running: collapses to a
    // single rerun after the in-flight run finishes.
    queue.enqueue("k", async () => {
      runCount += 1;
    });
    queue.enqueue("k", async () => {
      runCount += 1;
    });
    queue.enqueue("k", async () => {
      runCount += 1;
    });

    gate.resolve();
    await queue.close();

    expect(runCount).toBe(2);
  });

  it("close() waits for the in-flight task and blocks new work", async () => {
    const gate = deferred();
    const events: string[] = [];
    const queue = new SyncQueue();

    queue.enqueue("a", async () => {
      events.push("a-start");
      await gate.promise;
      events.push("a-end");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["a-start"]);

    const closePromise = queue.close();
    gate.resolve();
    await closePromise;

    expect(events).toEqual(["a-start", "a-end"]);

    // Enqueue after close() is a documented no-op: the task never runs.
    let ranAfterClose = false;
    queue.enqueue("late", async () => {
      ranAfterClose = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ranAfterClose).toBe(false);
  });
});
