import { and, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import PQueue from 'p-queue';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { devices, groups, jobs } from '../db/schema.js';
import type { EventBus } from '../realtime/bus.js';
import { collectDevice } from './backup.js';
import { InlineCollector } from './collector/inline.js';
import type { TaskRunner } from './collector/types.js';
import type { DriverRegistry } from './models/registry.js';

const TICK_MS = 5_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
// On startup, devices that are already due (or were never scheduled) are
// spread across this window instead of all firing on the first tick — so a
// container restart doesn't kick off an immediate stampede of backups.
const STARTUP_SPREAD_SEC = 300;
// Hold off the first backup run for this long after boot, so the process, DB,
// and network can settle before collection starts.
const STARTUP_DELAY_MS = 60_000;

export class Scheduler {
  private queue: PQueue;
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private inFlight = new Set<string>();
  /** Runs a prepared collection task — the worker pool when present, else inline. */
  private run: TaskRunner;

  constructor(
    private ctx: {
      db: Db;
      config: AppConfig;
      registry: DriverRegistry;
      bus: EventBus;
      /** Collector pool; when omitted, collection runs inline on the main thread. */
      pool?: { submit: TaskRunner };
      log?: { warn?: (o: unknown, m: string) => void; info?: (o: unknown, m: string) => void };
    },
    // Concurrency of *prepared* tasks in flight; defaults to the pool size so
    // DB job rows and worker capacity stay in step.
    concurrency = ctx.config.collectorPoolSize,
  ) {
    this.queue = new PQueue({ concurrency: Math.max(1, Number(concurrency) || 4) });
    const inline = new InlineCollector(ctx.registry);
    this.run = ctx.pool ? ctx.pool.submit : (task) => inline.run(task);
  }

  async start() {
    // Recover devices stuck in `running` from an unclean shutdown (best-effort;
    // a DB hiccup here must not stop the scheduler from starting).
    try {
      await this.ctx.db
        .update(devices)
        .set({ lastStatus: 'failed', lastError: 'interrupted by restart' })
        .where(eq(devices.lastStatus, 'running'));
      await this.ctx.db
        .update(jobs)
        .set({ status: 'failed', error: 'interrupted by restart', finishedAt: new Date() })
        .where(or(eq(jobs.status, 'running'), eq(jobs.status, 'queued')));
    } catch (err) {
      this.ctx.log?.warn?.({ err }, 'scheduler startup recovery failed');
    }

    // Persisted schedules (a future next_run_at) are honored as-is across a
    // restart. Only devices that are currently due or have never been
    // scheduled get re-anchored to a jittered near-future slot, so restarting
    // the container doesn't trigger an immediate wave of backups. Best-effort:
    // a failure here must not stop the scheduler from starting.
    try {
      const rescheduled = await this.ctx.db
        .update(devices)
        .set({
          nextRunAt: sql`now() + random() * ${STARTUP_SPREAD_SEC} * interval '1 second'`,
        })
        .where(
          and(
            eq(devices.enabled, true),
            or(isNull(devices.nextRunAt), lte(devices.nextRunAt, new Date())),
          ),
        )
        .returning({ id: devices.id });
      if (rescheduled.length > 0) {
        this.ctx.log?.info?.(
          { count: rescheduled.length, spreadSec: STARTUP_SPREAD_SEC },
          'spread due/unscheduled devices over startup window',
        );
      }
    } catch (err) {
      this.ctx.log?.warn?.({ err }, 'scheduler startup reschedule failed');
    }

    // Settle delay: don't run any backup for the first STARTUP_DELAY_MS after
    // boot. The reschedule above already spread due work into the future; this
    // also covers devices whose persisted next_run_at falls within the window.
    const beginTicking = () => {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.timer.unref();
      void this.tick();
    };
    this.startupTimer = setTimeout(beginTicking, STARTUP_DELAY_MS);
    this.startupTimer.unref();
  }

  async stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.timer) clearInterval(this.timer);
    this.queue.clear();
    await this.queue.onIdle();
  }

  /** Devices due for a backup now. */
  private selectDue() {
    return this.ctx.db
      .select({
        id: devices.id,
        intervalSec: devices.intervalSec,
        defaultIntervalSec: groups.defaultIntervalSec,
        consecutiveFailures: devices.consecutiveFailures,
      })
      .from(devices)
      .innerJoin(groups, eq(devices.groupId, groups.id))
      .where(
        and(
          eq(devices.enabled, true),
          ne(devices.lastStatus, 'running'),
          or(isNull(devices.nextRunAt), lte(devices.nextRunAt, new Date())),
        ),
      )
      .limit(200);
  }

  async tick() {
    let due: Awaited<ReturnType<typeof this.selectDue>>;
    try {
      due = await this.selectDue();
    } catch (err) {
      // A transient DB error (e.g. a brief Postgres restart / reconnect) must
      // not crash the scheduler — log and try again on the next tick.
      this.ctx.log?.warn?.({ err }, 'scheduler tick query failed; will retry');
      return;
    }

    for (const d of due) {
      if (this.inFlight.has(d.id)) continue;
      this.inFlight.add(d.id);
      void this.queue.add(async () => {
        try {
          await this.runOne(d.id, d.intervalSec ?? d.defaultIntervalSec, d.consecutiveFailures);
        } catch (err) {
          // A single device must never crash the scheduler / process.
          this.ctx.log?.warn?.({ err, deviceId: d.id }, 'scheduled backup threw');
        } finally {
          this.inFlight.delete(d.id);
        }
      });
    }
  }

  /** Manually triggered backups also reschedule through here. */
  async runOne(deviceId: string, intervalSec: number, priorFailures: number) {
    const { db, bus } = this.ctx;
    const [dev] = await db
      .select({ orgId: devices.orgId, name: devices.name })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    if (!dev) return;

    bus.publish({ type: 'job.started', orgId: dev.orgId, deviceId, deviceName: dev.name });
    const outcome = await collectDevice(this.ctx, this.run, deviceId, 'scheduled');

    const intervalMs = intervalSec * 1000;
    const delay =
      outcome.status === 'success'
        ? intervalMs
        : Math.min(intervalMs * 2 ** (priorFailures + 1), MAX_BACKOFF_MS);
    await db
      .update(devices)
      .set({ nextRunAt: new Date(Date.now() + delay) })
      .where(eq(devices.id, deviceId));

    bus.publish({
      type: 'job.finished',
      orgId: dev.orgId,
      deviceId,
      deviceName: dev.name,
      jobId: outcome.jobId,
      status: outcome.status,
      commitSha: outcome.commitSha,
    });
  }
}
