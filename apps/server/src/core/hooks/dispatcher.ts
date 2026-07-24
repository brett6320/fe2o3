import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { hooks } from '../../db/schema.js';
import type { BackupEvent, EventBus } from '../../realtime/bus.js';

export type HookEvent = 'backup_changed' | 'backup_failed' | 'backup_success';

export interface HookPayload {
  event: HookEvent;
  orgId: string;
  deviceId: string;
  deviceName?: string | undefined;
  jobId?: string | undefined;
  commitSha?: string | null | undefined;
  timestamp: string;
}

async function deliver(
  hook: { type: string; config: Record<string, string> },
  payload: HookPayload,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    if (hook.type === 'slack') {
      const text =
        payload.event === 'backup_failed'
          ? `:warning: Backup failed for *${payload.deviceName}*`
          : `:white_check_mark: Config changed on *${payload.deviceName}* (${payload.commitSha?.slice(0, 8)})`;
      await fetch(hook.config.url ?? '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } else {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (hook.config.secret) {
        headers['X-Fe2o3-Signature'] = createHmac('sha256', hook.config.secret)
          .update(body)
          .digest('hex');
      }
      await fetch(hook.config.url ?? '', {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function eventsFor(e: BackupEvent): HookEvent[] {
  if (e.type !== 'job.finished') return [];
  if (e.status === 'failed') return ['backup_failed'];
  const out: HookEvent[] = ['backup_success'];
  if (e.commitSha) out.push('backup_changed');
  return out;
}

/** Subscribe hook delivery to the event bus. Returns unsubscribe. */
export function startHookDispatcher(
  db: Db,
  bus: EventBus,
  log?: { warn: (o: unknown, m: string) => void },
) {
  return bus.subscribe((event) => {
    void (async () => {
      const fired = eventsFor(event);
      if (fired.length === 0) return;
      const rows = await db
        .select()
        .from(hooks)
        .where(and(eq(hooks.orgId, event.orgId), eq(hooks.enabled, true)));
      for (const hook of rows) {
        for (const he of fired) {
          if (!hook.events.includes(he)) continue;
          const payload: HookPayload = {
            event: he,
            orgId: event.orgId,
            deviceId: event.deviceId,
            deviceName: event.deviceName,
            jobId: event.jobId,
            commitSha: event.commitSha,
            timestamp: new Date().toISOString(),
          };
          deliver(hook, payload).catch((err) =>
            log?.warn({ err, hook: hook.id }, 'hook delivery failed'),
          );
        }
      }
    })();
  });
}

export { deliver as deliverHook };
