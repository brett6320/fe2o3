import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema.js';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('audit hash chain', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;

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
    cookie = cookieOf(setup);
    const orgId = setup.json().orgs[0].id;
    // generate a few chained entries
    for (const slug of ['g1', 'g2', 'g3']) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${orgId}/groups`,
        cookies: cookie,
        payload: { name: slug, pathSlug: slug },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('links every entry to its predecessor', async () => {
    const rows = await app.db.select().from(auditLog).orderBy(auditLog.seq);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]?.prevHash).toBe('genesis');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.prevHash).toBe(rows[i - 1]?.entryHash);
      expect(rows[i]?.entryHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('verify endpoint reports an intact chain', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify', cookies: cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().checked).toBeGreaterThanOrEqual(3);
    expect(res.json().firstInvalidSeq).toBeNull();
  });

  it('detects tampering with a historical entry', async () => {
    const rows = await app.db.select().from(auditLog).orderBy(auditLog.seq);
    const victim = rows[1];
    if (!victim) throw new Error('need at least 2 entries');
    await app.db
      .update(auditLog)
      .set({ resource: '/api/v1/definitely-not-what-happened' })
      .where(eq(auditLog.id, victim.id));

    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify', cookies: cookie });
    expect(res.json().ok).toBe(false);
    expect(res.json().firstInvalidSeq).toBe(victim.seq);
  });
});
