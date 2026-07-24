import type { FastifyInstance } from 'fastify';
import { generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('totp mfa + api keys', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;
  let orgId: string;
  let secret: string;

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
    cookie = cookieOf(setup);
  });

  afterAll(async () => {
    await app.close();
  });

  it('enrolls and confirms TOTP', async () => {
    const enroll = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/totp/enroll',
      cookies: cookie,
    });
    expect(enroll.statusCode).toBe(200);
    const otpauthUrl: string = enroll.json().otpauthUrl;
    secret = new URL(otpauthUrl).searchParams.get('secret') ?? '';
    expect(secret.length).toBeGreaterThan(10);
    expect(enroll.json().qrDataUrl).toMatch(/^data:image\/png/);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/totp/confirm',
      cookies: cookie,
      payload: { code: '000000' },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/totp/confirm',
      cookies: cookie,
      payload: { code: generateSync({ secret }) },
    });
    expect(good.statusCode).toBe(200);
  });

  it('login now requires step-up; mfa_pending session is blocked from org data', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.co', password: 'longpassword1' },
    });
    expect(login.json().mfaPending).toBe(true);
    const pending = cookieOf(login);

    const blocked = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: pending,
    });
    expect(blocked.statusCode).toBe(401);

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/totp',
      cookies: pending,
      payload: { code: generateSync({ secret }) },
    });
    expect(verify.statusCode).toBe(200);

    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: pending,
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('api keys: create, use with bearer auth, scope enforcement, delete', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      cookies: cookie,
      payload: { name: 'ci', scope: 'read' },
    });
    expect(created.statusCode).toBe(200);
    const token: string = created.json().token;
    expect(token).toMatch(/^fe2o3_/);

    // read works
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);

    // write blocked for read scope
    const write = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X', pathSlug: 'x' },
    });
    expect(write.statusCode).toBe(403);

    // write scope key can mutate
    const writeKey = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      cookies: cookie,
      payload: { name: 'automation', scope: 'write' },
    });
    const write2 = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      headers: { authorization: `Bearer ${writeKey.json().token}` },
      payload: { name: 'X', pathSlug: 'x' },
    });
    expect(write2.statusCode).toBe(200);

    // deleted key stops working
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${created.json().id}`,
      cookies: cookie,
    });
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('every generated token parses regardless of base64url characters', async () => {
    // regression: '_' inside the token used to break prefix/secret splitting
    for (let i = 0; i < 15; i++) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        cookies: cookie,
        payload: { name: `k${i}`, scope: 'read' },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}/devices`,
        headers: { authorization: `Bearer ${created.json().token}` },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('audit log records mutations', async () => {
    const { auditLog } = await import('../src/db/schema.js');
    const rows = await app.db.select().from(auditLog);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.resource.includes('/groups'))).toBe(true);
  });
});
