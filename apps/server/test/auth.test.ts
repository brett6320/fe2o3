import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const SETUP = {
  email: 'admin@example.com',
  password: 'correct-horse-battery',
  displayName: 'Admin',
  orgName: 'Acme Networks',
  orgSlug: 'acme',
};

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('setup + auth + rbac', () => {
  let app: FastifyInstance;
  let adminCookie: Record<string, string>;
  let orgId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports needsSetup then completes setup', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(status.json()).toEqual({ needsSetup: true });

    const res = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: SETUP });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isSuperadmin).toBe(true);
    expect(body.orgs).toHaveLength(1);
    expect(body.orgs[0].slug).toBe('acme');
    orgId = body.orgs[0].id;
    adminCookie = cookieOf(res);

    const again = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: SETUP });
    expect(again.statusCode).toBe(409);
  });

  it('rejects bad credentials, accepts good ones', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: SETUP.email, password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: SETUP.email, password: SETUP.password },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().mfaPending).toBe(false);
  });

  it('session endpoint requires auth', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(anon.statusCode).toBe(401);
    const authed = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: adminCookie,
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.json().email).toBe(SETUP.email);
  });

  it('enforces superadmin on user management', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      cookies: adminCookie,
      payload: { email: 'viewer@example.com', password: 'viewer-pass-123', displayName: 'Viewer' },
    });
    expect(created.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer@example.com', password: 'viewer-pass-123' },
    });
    const viewerCookie = cookieOf(login);

    const denied = await app.inject({ method: 'GET', url: '/api/v1/users', cookies: viewerCookie });
    expect(denied.statusCode).toBe(403);
  });

  it('org member endpoints enforce membership and role', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer@example.com', password: 'viewer-pass-123' },
    });
    const viewerCookie = cookieOf(login);
    const viewerId = login.json().id;

    // not a member yet → 403
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/members`,
      cookies: viewerCookie,
    });
    expect(denied.statusCode).toBe(403);

    // superadmin grants readonly membership
    const grant = await app.inject({
      method: 'PUT',
      url: `/api/v1/orgs/${orgId}/members`,
      cookies: adminCookie,
      payload: { userId: viewerId, role: 'readonly' },
    });
    expect(grant.statusCode).toBe(200);

    // readonly can list members but not modify them
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/members`,
      cookies: viewerCookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(2);

    const escalate = await app.inject({
      method: 'PUT',
      url: `/api/v1/orgs/${orgId}/members`,
      cookies: viewerCookie,
      payload: { userId: viewerId, role: 'admin' },
    });
    expect(escalate.statusCode).toBe(403);
  });

  it('audit endpoint is superadmin-only and records mutations', async () => {
    const entries = await app.inject({ method: 'GET', url: '/api/v1/audit', cookies: adminCookie });
    expect(entries.statusCode).toBe(200);
    expect(entries.json().length).toBeGreaterThan(0);
    expect(entries.json()[0].userEmail).toBeTruthy();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer@example.com', password: 'viewer-pass-123' },
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      cookies: cookieOf(login),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('disabling a user kills their sessions', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer@example.com', password: 'viewer-pass-123' },
    });
    const viewerCookie = cookieOf(login);
    const viewerId = login.json().id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${viewerId}`,
      cookies: adminCookie,
      payload: { disabled: true },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: viewerCookie,
    });
    expect(after.statusCode).toBe(401);
  });
});
