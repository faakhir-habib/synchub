// A single serialized work queue. Tasks are run strictly one at a time
// (never overlapping), same-key bursts are coalesced, a throwing task
// never breaks the queue, and close() finishes the in-flight task and
// then abandons the rest for a fast, bounded shutdown.
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
   * Finish the in-flight task, then abandon any remaining pending jobs
   * (including queued reruns) and stop accepting new work. This is a
   * fast, bounded shutdown, not a full drain: abandoned jobs are not run.
   * That's safe here because callers re-diff on the next boot reconcile,
   * so nothing is lost — it's simply picked up again later.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.idlePromise) {
      await this.idlePromise;
    }
  }

  /**
   * Wait for the queue to go idle naturally — i.e. for everything
   * currently pending/running to finish — WITHOUT stopping it from
   * accepting new work. Unlike close(), this never abandons pending jobs.
   */
  async whenIdle(): Promise<void> {
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
      // close() only guarantees the in-flight task finishes. Once closed,
      // stop picking up further pending jobs rather than draining the
      // whole backlog — that's what makes shutdown fast and bounded.
      if (this.closed) break;

      const job = this.pending.shift();
      if (!job) break;
      this.pendingKeys.delete(job.key);
      this.runningKey = job.key;

      try {
        await job.task();
      } catch (err) {
        try {
          this.onError?.(err, job.key);
        } catch (onErrorErr) {
          // A throwing onError must never wedge the consumer loop or
          // leave close()/whenIdle() hanging forever.
          console.error("SyncQueue onError callback threw:", onErrorErr);
        }
      }

      this.runningKey = null;

      if (this.closed) break;

      const rerun = this.rerunTasks.get(job.key);
      if (rerun) {
        this.rerunTasks.delete(job.key);
        this.pending.push({ key: job.key, task: rerun });
        this.pendingKeys.add(job.key);
      }
    }

    if (this.closed) {
      // Abandon whatever's left — the next boot reconcile re-diffs and
      // picks these back up, so nothing is silently lost.
      this.pending.length = 0;
      this.pendingKeys.clear();
      this.rerunTasks.clear();
    }

    this.loopRunning = false;
    const resolve = this.idleResolve;
    this.idleResolve = null;
    resolve?.();
  }
}
