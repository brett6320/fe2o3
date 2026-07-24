import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../src/core/scheduler.js';
import { buildTestApp } from './helpers.js';

describe('scheduler resilience', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a failing tick query is logged and swallowed, not thrown', async () => {
    const warns: unknown[] = [];
    const scheduler = new Scheduler({
      db: app.db,
      config: app.config,
      registry: app.registry,
      bus: app.bus,
      log: { warn: (o) => warns.push(o) },
    });

    // simulate a transient DB error on the due-devices query
    const spy = vi.spyOn(app.db, 'select').mockImplementationOnce(() => {
      throw Object.assign(new Error('password authentication failed for user "fe2o3"'), {
        code: '28P01',
      });
    });

    // must resolve (not reject / crash) despite the query throwing
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(warns.length).toBe(1);

    spy.mockRestore();
    // next tick works normally
    await expect(scheduler.tick()).resolves.toBeUndefined();
  });
});
