import { describe, expect, it } from 'vitest';
import { CollectorPool } from '../src/core/collector/pool.js';
import type { Collector, CollectResult, CollectTask } from '../src/core/collector/types.js';

const task = (jobId: string): CollectTask => ({
  jobId,
  deviceId: `d-${jobId}`,
  deviceName: jobId,
  driverId: 'ios',
  protocol: 'ssh',
  connect: { host: '127.0.0.1', port: 22, username: 'x' },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class FakeCollector implements Collector {
  closed = false;
  constructor(private handler: (t: CollectTask) => Promise<CollectResult>) {}
  run(t: CollectTask) {
    return this.handler(t);
  }
  async close() {
    this.closed = true;
  }
}

describe('CollectorPool', () => {
  it('runs a task on an idle collector and returns its result', async () => {
    const pool = new CollectorPool({
      size: 2,
      createCollector: () => new FakeCollector(async (t) => ({ ok: true, configText: t.jobId })),
    });
    const res = await pool.submit(task('a'));
    expect(res).toEqual({ ok: true, configText: 'a' });
    await pool.close();
  });

  it('caps concurrency at the pool size, queueing the rest', async () => {
    const gate = deferred<void>();
    let active = 0;
    let maxActive = 0;
    const pool = new CollectorPool({
      size: 1,
      createCollector: () =>
        new FakeCollector(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await gate.promise;
          active--;
          return { ok: true };
        }),
    });

    const a = pool.submit(task('a'));
    const b = pool.submit(task('b'));
    // let microtasks settle: only one should be active with size 1
    await new Promise((r) => setTimeout(r, 20));
    expect(active).toBe(1);

    gate.resolve();
    await Promise.all([a, b]);
    expect(maxActive).toBe(1);
    await pool.close();
  });

  it('respawns and falls back inline when a collector dies mid-task', async () => {
    let created = 0;
    const fallback = new FakeCollector(async () => ({ ok: true, configText: 'from-fallback' }));
    const pool = new CollectorPool({
      size: 1,
      // every worker dies (rejects) as soon as it runs a task
      createCollector: () => {
        created++;
        return new FakeCollector(() => Promise.reject(new Error('worker died')));
      },
      fallback,
    });

    const res = await pool.submit(task('a'));
    expect(res).toEqual({ ok: true, configText: 'from-fallback' });
    // a replacement collector was spawned to keep the pool at size
    expect(created).toBeGreaterThanOrEqual(2);

    const res2 = await pool.submit(task('b'));
    expect(res2.configText).toBe('from-fallback');
    await pool.close();
  });

  it('returns a failed result (no throw) when a collector dies and no fallback exists', async () => {
    const pool = new CollectorPool({
      size: 1,
      createCollector: () => new FakeCollector(() => Promise.reject(new Error('worker died'))),
    });
    const res = await pool.submit(task('a'));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('worker died');
    await pool.close();
  });

  it('rejects in-flight waiters and new submits once closing', async () => {
    const gate = deferred<void>();
    const pool = new CollectorPool({
      size: 1,
      createCollector: () =>
        new FakeCollector(async () => {
          await gate.promise;
          return { ok: true };
        }),
    });

    const busy = pool.submit(task('a')); // occupies the only collector
    const queued = pool.submit(task('b')); // waits for a collector

    const closing = pool.close();
    const queuedRes = await queued;
    expect(queuedRes.ok).toBe(false);
    expect(queuedRes.error).toContain('shutting down');

    // a submit after close also fails fast
    const late = await pool.submit(task('c'));
    expect(late.ok).toBe(false);

    gate.resolve();
    await busy;
    await closing;
  });
});
