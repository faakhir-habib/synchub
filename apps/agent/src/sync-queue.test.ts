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

    // Use whenIdle() (not close()) here: this test is about ordering, not
    // about close()'s abandon-pending shutdown semantics.
    await queue.whenIdle();
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

    // whenIdle() (not close()): asserting that "ok" still runs after
    // "fail" throws is about error isolation, not close()'s shutdown
    // semantics.
    await queue.whenIdle();

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
    // whenIdle() (not close()): this test is about pending-window
    // coalescing, not close()'s shutdown semantics.
    await queue.whenIdle();

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
    // whenIdle() (not close()): this test is about running-window
    // coalescing (the rerun), not close()'s shutdown semantics.
    await queue.whenIdle();

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

  it("close() finishes the in-flight task but abandons remaining pending jobs", async () => {
    const gate = deferred();
    const ran: string[] = [];
    const queue = new SyncQueue();

    queue.enqueue("a", async () => {
      ran.push("a");
      await gate.promise;
    });
    queue.enqueue("b", async () => {
      ran.push("b");
    });
    queue.enqueue("c", async () => {
      ran.push("c");
    });

    // Give the loop a tick to start "a" (which then suspends on its gate),
    // leaving "b" and "c" behind it in the pending backlog.
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toEqual(["a"]);

    const closePromise = queue.close();
    gate.resolve();
    await closePromise;

    // Fast, bounded shutdown: "a" (in-flight) finished, but "b" and "c"
    // were abandoned rather than drained — they're picked up again by the
    // next boot reconcile instead.
    expect(ran).toEqual(["a"]);
  });

  it("does not let a throwing onError stop the queue from processing the next task", async () => {
    const ran: string[] = [];
    const queue = new SyncQueue({
      onError: () => {
        throw new Error("onError also throws");
      },
    });

    queue.enqueue("fail", async () => {
      ran.push("fail");
      throw new Error("boom");
    });
    queue.enqueue("ok", async () => {
      ran.push("ok");
    });

    await queue.whenIdle();
    expect(ran).toEqual(["fail", "ok"]);
  });

  it("does not let a throwing onError deadlock close()", async () => {
    const gate = deferred();
    const queue = new SyncQueue({
      onError: () => {
        throw new Error("onError also throws");
      },
    });

    queue.enqueue("fail", async () => {
      await gate.promise;
      throw new Error("boom");
    });

    await Promise.resolve();
    await Promise.resolve();

    const closePromise = queue.close();
    gate.resolve();

    // Before the fix, an unguarded onError throw escaped the consumer
    // loop mid-iteration, leaving runningKey/idleResolve stuck forever —
    // so close() never resolved. If that regresses, this await hangs and
    // vitest's test timeout is the backstop.
    await closePromise;
  });
});
