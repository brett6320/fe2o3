import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/core/scheduler.js';
import { devices } from '../src/db/schema.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';
import { buildTestApp } from './helpers.js';

const fakeSpec = {
  prompt: 'sw1#',
  username: 'backup',
  password: 'pw',
  responses: {
    'terminal length 0': '',
    'terminal width 0': '',
    'show version': 'FakeOS 1.0',
    'show inventory': 'NAME: fake',
    'show running-config': 'hostname sw1\nend',
  },
};

describe('scheduler', () => {
  let app: FastifyInstance;
  let fake: Awaited<ReturnType<typeof startFakeDevice>>;
  let scheduler: Scheduler;
  let cookie: Record<string, string>;
  let orgId: string;
  let deviceId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    fake = await startFakeDevice(fakeSpec);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        email: 'a@b.co',
        password: 'longpassword1',
        orgName: 'T',
        orgSlug: 't',
        displayName: '',
      },
    });
    orgId = setup.json().orgs[0].id;
    cookie = {
      fe2o3_session:
        setup.cookies.find((c: { name: string }) => c.name === 'fe2o3_session')?.value ?? '',
    };
    const cred = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/credentials`,
      cookies: cookie,
      payload: { name: 'c', username: 'backup', password: 'pw' },
    });
    const group = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: {
        name: 'G',
        pathSlug: 'g',
        defaultCredentialId: cred.json().id,
        defaultIntervalSec: 60,
      },
    });
    const device = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
      payload: {
        name: 'sw1',
        host: '127.0.0.1',
        port: fake.port,
        modelId: 'ios',
        groupId: group.json().id,
        backupNow: true,
      },
    });
    deviceId = device.json().id;
    scheduler = new Scheduler(
      { db: app.db, config: app.config, registry: app.registry, bus: app.bus },
      2,
    );
  });

  afterAll(async () => {
    await scheduler.stop();
    await app.close();
    await fake.close();
  });

  it('picks up due devices, backs them up, and reschedules', async () => {
    const events: string[] = [];
    app.bus.subscribe((e) => events.push(e.type));

    await scheduler.tick();
    // wait for the queued backup to finish
    await new Promise((r) => setTimeout(r, 3000));

    const [d] = await app.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(d?.lastStatus).toBe('success');
    expect(d?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    expect(events).toContain('job.started');
    expect(events).toContain('job.finished');
  }, 15000);

  it('applies exponential backoff on failure', async () => {
    await app.db
      .update(devices)
      .set({ host: '127.0.0.1', port: 1, nextRunAt: new Date(Date.now() - 1000) })
      .where(eq(devices.id, deviceId));

    await scheduler.tick();
    await new Promise((r) => setTimeout(r, 3000));

    const [d] = await app.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(d?.lastStatus).toBe('failed');
    expect(d?.consecutiveFailures).toBe(1);
    // backoff = interval(60s) * 2^1 = 120s
    const delay = (d?.nextRunAt?.getTime() ?? 0) - Date.now();
    expect(delay).toBeGreaterThan(60_000);
  }, 15000);
});

describe('scheduler startup scheduling', () => {
  let app: FastifyInstance;
  let scheduler: Scheduler;
  let cookie: Record<string, string>;
  let orgId: string;
  let groupId: string;

  const addDevice = async (name: string, nextRunAt: Date | null) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
      payload: {
        name,
        host: '127.0.0.1',
        port: 1,
        modelId: 'ios',
        groupId,
        backupNow: false,
      },
    });
    const id = res.json().id as string;
    await app.db.update(devices).set({ nextRunAt }).where(eq(devices.id, id));
    return id;
  };

  beforeAll(async () => {
    app = await buildTestApp();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        email: 'a@b.co',
        password: 'longpassword1',
        orgName: 'T',
        orgSlug: 't',
        displayName: '',
      },
    });
    orgId = setup.json().orgs[0].id;
    cookie = {
      fe2o3_session:
        setup.cookies.find((c: { name: string }) => c.name === 'fe2o3_session')?.value ?? '',
    };
    const cred = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/credentials`,
      cookies: cookie,
      payload: { name: 'c', username: 'backup', password: 'pw' },
    });
    const group = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: {
        name: 'G',
        pathSlug: 'g',
        defaultCredentialId: cred.json().id,
        defaultIntervalSec: 3600,
      },
    });
    groupId = group.json().id;
  });

  afterAll(async () => {
    await scheduler.stop();
    await app.close();
  });

  it('preserves future schedules and spreads only overdue/unscheduled devices on start', async () => {
    const future = new Date(Date.now() + 30 * 60_000); // 30 min out, must be untouched
    const futureId = await addDevice('future', future);
    const overdueId = await addDevice('overdue', new Date(Date.now() - 60_000));
    const nullId = await addDevice('never-scheduled', null);

    const startedAt = Date.now();
    scheduler = new Scheduler(
      { db: app.db, config: app.config, registry: app.registry, bus: app.bus },
      2,
    );
    await scheduler.start();

    const rows = await app.db.select().from(devices);
    const byId = new Map(rows.map((r) => [r.id, r.nextRunAt]));

    // Persisted future schedule survives the restart unchanged.
    expect(byId.get(futureId)?.getTime()).toBe(future.getTime());

    // Overdue and never-scheduled devices are re-anchored into the near-future
    // startup window rather than firing immediately.
    for (const id of [overdueId, nullId]) {
      const at = byId.get(id)?.getTime() ?? 0;
      expect(at).toBeGreaterThanOrEqual(startedAt);
      expect(at).toBeLessThanOrEqual(startedAt + 300_000 + 5_000);
    }
  }, 15000);
});
