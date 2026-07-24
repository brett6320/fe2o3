import { describe, expect, it, vi } from 'vitest';

// Exercise the transient-error retry loop without a real Postgres by mocking
// the pg migrator to fail a couple of times with a transient auth error.
const attempts = { n: 0 };

vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: vi.fn(async () => {
    attempts.n++;
    if (attempts.n < 3) {
      const err = new Error('password authentication failed for user "fe2o3"') as Error & {
        code?: string;
      };
      err.code = '28P01';
      throw err;
    }
  }),
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: vi.fn(() => ({}) as never) }));
vi.mock('pg', () => ({ default: { Pool: vi.fn(() => ({ on: vi.fn() })) } }));

describe('database startup retry', () => {
  it('retries transient auth/connection errors then succeeds', async () => {
    const { createDb } = await import('../src/db/index.js');
    const warns: string[] = [];
    const db = await createDb({
      databaseUrl: 'postgres://fe2o3:pw@db:5432/fe2o3',
      connectRetries: 5,
      connectRetryDelayMs: 5,
      log: { warn: (_o, m) => warns.push(m) },
    });
    expect(db).toBeDefined();
    expect(attempts.n).toBe(3); // failed twice, succeeded on the third
    expect(warns.length).toBe(2);
  });

  it('gives up after exhausting retries', async () => {
    attempts.n = -100; // force it to always throw within the retry budget
    const { createDb } = await import('../src/db/index.js');
    await expect(
      createDb({
        databaseUrl: 'postgres://fe2o3:pw@db:5432/fe2o3',
        connectRetries: 2,
        connectRetryDelayMs: 5,
      }),
    ).rejects.toThrow(/password authentication failed/);
  });
});
