import type { Collector, CollectResult, CollectTask, TaskRunner } from './types.js';

interface Waiter {
  resolve: (c: Collector) => void;
  reject: (err: Error) => void;
}

export interface CollectorPoolOptions {
  /** Number of collectors to keep alive (clamped to a minimum of 1). */
  size: number;
  /** Factory for a fresh collector (e.g. a worker-backed one). */
  createCollector: () => Collector;
  /**
   * Optional main-thread collector used to finish a task whose worker died,
   * so a broken worker degrades gracefully instead of losing backups.
   */
  fallback?: Collector;
  log?: { warn?: (o: unknown, m: string) => void; error?: (o: unknown, m: string) => void };
}

/**
 * A fixed-size pool of collectors. `submit` hands the task to an idle collector,
 * queueing (backpressure) when all are busy. If a collector's worker dies
 * mid-task the pool discards it, respawns a replacement, and — when a fallback
 * is configured — reruns the task inline so no backup is silently dropped.
 */
export class CollectorPool {
  readonly size: number;
  private idle: Collector[] = [];
  private live = new Set<Collector>();
  private waiters: Waiter[] = [];
  private closing = false;

  constructor(private opts: CollectorPoolOptions) {
    this.size = Math.max(1, opts.size);
    for (let i = 0; i < this.size; i++) this.add(this.opts.createCollector());
  }

  /** Bound method usable directly as a TaskRunner. */
  readonly submit: TaskRunner = (task: CollectTask) => this.run(task);

  private add(c: Collector) {
    this.live.add(c);
    this.handOut(c);
  }

  private handOut(c: Collector) {
    const w = this.waiters.shift();
    if (w) w.resolve(c);
    else this.idle.push(c);
  }

  private acquire(): Promise<Collector> {
    const c = this.idle.pop();
    if (c) return Promise.resolve(c);
    return new Promise<Collector>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private async run(task: CollectTask): Promise<CollectResult> {
    if (this.closing) return { ok: false, error: 'collector pool is shutting down' };
    let collector: Collector;
    try {
      collector = await this.acquire();
    } catch {
      return { ok: false, error: 'collector pool is shutting down' };
    }
    try {
      const result = await collector.run(task);
      this.handOut(collector); // healthy → return to the pool
      return result;
    } catch (err) {
      // The collector's worker broke. Discard it, keep the pool at size, and
      // don't drop the task: rerun it inline when a fallback is available.
      this.live.delete(collector);
      void collector.close().catch(() => {});
      this.opts.log?.warn?.({ err, jobId: task.jobId }, 'collector died mid-task; respawning');
      if (!this.closing && this.live.size < this.size) this.add(this.opts.createCollector());
      if (this.opts.fallback) {
        try {
          return await this.opts.fallback.run(task);
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const w of this.waiters.splice(0)) {
      w.reject(new Error('collector pool is shutting down'));
    }
    const all = [...this.live];
    this.live.clear();
    this.idle = [];
    await Promise.all(all.map((c) => c.close().catch(() => {})));
    if (this.opts.fallback) await this.opts.fallback.close().catch(() => {});
  }
}
