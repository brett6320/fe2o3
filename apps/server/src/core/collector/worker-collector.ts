import { Worker } from 'node:worker_threads';
import type { Collector, CollectResult, CollectTask } from './types.js';

interface Pending {
  jobId: string;
  resolve: (r: CollectResult) => void;
  reject: (err: Error) => void;
}

/**
 * One collector backed by a single worker_thread. Runs one task at a time (the
 * pool enforces that). `run` rejects only when the worker itself breaks (crash,
 * abnormal exit) — that tells the pool to discard and respawn this collector.
 */
export class WorkerCollector implements Collector {
  private worker: Worker;
  private pending: Pending | null = null;
  private dead = false;

  constructor(
    private opts: { driversDir: string; log?: { error?: (o: unknown, m: string) => void } },
  ) {
    // worker_threads do NOT inherit the parent's tsx ESM loader, so register it
    // inside the worker before importing the TypeScript entry point. Using
    // dynamic import() keeps the eval bootstrap valid CommonJS.
    const workerUrl = new URL('./worker.ts', import.meta.url).href;
    const bootstrap = `(async () => {
      const { register } = await import('tsx/esm/api');
      register();
      await import(${JSON.stringify(workerUrl)});
    })().catch((err) => { console.error(err); process.exit(1); });`;

    this.worker = new Worker(bootstrap, {
      eval: true,
      workerData: { driversDir: opts.driversDir },
    });
    this.worker.on('message', (msg: { type?: string; jobId?: string; result?: CollectResult }) => {
      if (msg?.type !== 'result' || !this.pending || msg.jobId !== this.pending.jobId) return;
      const p = this.pending;
      this.pending = null;
      p.resolve(msg.result ?? { ok: false, error: 'collector returned no result' });
    });
    this.worker.on('error', (err) => this.fail(err));
    this.worker.on('exit', (code) => {
      if (code !== 0) this.fail(new Error(`collector worker exited (code ${code})`));
    });
  }

  private fail(err: Error) {
    this.dead = true;
    this.opts.log?.error?.({ err }, 'collector worker failed');
    const p = this.pending;
    this.pending = null;
    p?.reject(err);
  }

  run(task: CollectTask): Promise<CollectResult> {
    if (this.dead) return Promise.reject(new Error('collector worker is dead'));
    if (this.pending) return Promise.reject(new Error('collector worker is busy'));
    return new Promise<CollectResult>((resolve, reject) => {
      this.pending = { jobId: task.jobId, resolve, reject };
      this.worker.postMessage({ type: 'collect', task });
    });
  }

  async close(): Promise<void> {
    this.dead = true;
    await this.worker.terminate();
  }
}
