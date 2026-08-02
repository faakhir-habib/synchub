// A single serialized work queue. Tasks are run strictly one at a time
// (never overlapping), same-key bursts are coalesced, a throwing task
// never breaks the queue, and close() drains the in-flight task and
// stops accepting new work.
//
// This fixes two legacy-agent problems: overlapping reconciles racing
// each other, and no graceful drain on shutdown.

export interface SyncQueueOptions {
  onError?: (err: unknown, key: string) => void;
}

interface PendingJob {
  key: string;
  task: () => Promise<void>;
}

export class SyncQueue {
  private readonly onError?: (err: unknown, key: string) => void;

  private readonly pending: PendingJob[] = [];
  private readonly pendingKeys = new Set<string>();

  /** Key currently being awaited by the consumer loop, if any. */
  private runningKey: string | null = null;
  /** Keys enqueued again while their job was running; rerun once after. */
  private readonly rerunTasks = new Map<string, () => Promise<void>>();

  private loopRunning = false;
  private closed = false;
  /** Resolves once the consumer loop has gone idle (no in-flight task). */
  private idleResolve: (() => void) | null = null;
  private idlePromise: Promise<void> | null = null;

  constructor(opts?: SyncQueueOptions) {
    this.onError = opts?.onError;
  }

  /**
   * Enqueue `task` under `key`. Enqueueing after close() is a documented
   * no-op — the task is dropped and never runs.
   */
  enqueue(key: string, task: () => Promise<void>): void {
    if (this.closed) return;

    if (this.runningKey === key) {
      // Already running: remember to run it once more when it finishes,
      // collapsing any further same-key enqueues into that single rerun.
      this.rerunTasks.set(key, task);
      return;
    }

    if (this.pendingKeys.has(key)) {
      // Already queued (not yet running): drop the duplicate.
      return;
    }

    this.pending.push({ key, task });
    this.pendingKeys.add(key);
    this.kick();
  }

  /**
   * Wait for the in-flight task to finish and stop accepting new work.
   * Already-pending jobs are NOT run — close() drains only the current
   * in-flight task, then resolves.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.idlePromise) {
      await this.idlePromise;
    }
  }

  private kick(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.idlePromise = new Promise((resolve) => {
      this.idleResolve = resolve;
    });
    void this.run();
  }

  private async run(): Promise<void> {
    while (this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.pendingKeys.delete(job.key);
      this.runningKey = job.key;

      try {
        await job.task();
      } catch (err) {
        this.onError?.(err, job.key);
      }

      this.runningKey = null;

      const rerun = this.rerunTasks.get(job.key);
      if (rerun) {
        this.rerunTasks.delete(job.key);
        this.pending.push({ key: job.key, task: rerun });
        this.pendingKeys.add(job.key);
      }
    }

    this.loopRunning = false;
    const resolve = this.idleResolve;
    this.idleResolve = null;
    resolve?.();
  }
}
