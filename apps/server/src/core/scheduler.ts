import { and, eq, isNull, lte, ne, or } from 'drizzle-orm';
import PQueue from 'p-queue';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { devices, groups, jobs } from '../db/schema.js';
import type { EventBus } from '../realtime/bus.js';
import { backupDevice } from './backup.js';
import type { DriverRegistry } from './models/registry.js';

const TICK_MS = 5_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

export class Scheduler {
  private queue: PQueue;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Set<string>();

  constructor(
    private ctx: {
      db: Db;
      config: AppConfig;
      registry: DriverRegistry;
      bus: EventBus;
      log?: { warn?: (o: unknown, m: string) => void };
    },
    concurrency = 20,
  ) {
    this.queue = new PQueue({ concurrency });
  }

  async start() {
    // Recover devices stuck in `running` from an unclean shutdown
    await this.ctx.db
      .update(devices)
      .set({ lastStatus: 'failed', lastError: 'interrupted by restart' })
      .where(eq(devices.lastStatus, 'running'));
    await this.ctx.db
      .update(jobs)
      .set({ status: 'failed', error: 'interrupted by restart', finishedAt: new Date() })
      .where(or(eq(jobs.status, 'running'), eq(jobs.status, 'queued')));

    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.queue.clear();
    await this.queue.onIdle();
  }

  async tick() {
    const due = await this.ctx.db
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
    const outcome = await backupDevice(this.ctx, deviceId, 'scheduled');

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
