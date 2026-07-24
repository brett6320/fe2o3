import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('admin global overview', () => {
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
        orgName: 'Acme',
        orgSlug: 'acme',
        displayName: '',
      },
    });
    cookie = cookieOf(setup);
    const orgA = setup.json().orgs[0].id;

    const orgB = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      cookies: cookie,
      payload: { name: 'Globex', slug: 'globex' },
    });
    const orgBId = orgB.json().id;

    // seed devices in each org (default lastStatus 'never')
    for (const [orgId, slug] of [
      [orgA, 'core'],
      [orgBId, 'edge'],
    ] as const) {
      const g = await app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${orgId}/groups`,
        cookies: cookie,
        payload: { name: slug, pathSlug: slug },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${orgId}/devices`,
        cookies: cookie,
        payload: { name: `${slug}-r1`, host: '10.0.0.1', modelId: 'ios', groupId: g.json().id },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls up device health across all tenants (superadmin only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      cookies: cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.tenants).toBe(2);
    expect(body.totals.devices).toBe(2);
    expect(body.totals.never).toBe(2);
    expect(body.tenants).toHaveLength(2);
    expect(body.tenants.map((t: { slug: string }) => t.slug).sort()).toEqual(['acme', 'globex']);
    expect(Array.isArray(body.recentFailures)).toBe(true);
  });

  it('is forbidden for non-superadmins', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      cookies: cookie,
      payload: { email: 'member@example.com', password: 'member-pass-12', displayName: 'M' },
    });
    expect(created.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@example.com', password: 'member-pass-12' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      cookies: cookieOf(login),
    });
    expect(res.statusCode).toBe(403);
  });
});
