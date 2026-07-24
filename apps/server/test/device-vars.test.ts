import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devices } from '../src/db/schema.js';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('encrypted device vars', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;
  let orgId: string;
  let deviceId: string;

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
    const group = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: { name: 'G', pathSlug: 'g' },
    });
    const device = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
      payload: {
        name: 'r1',
        host: '10.0.0.1',
        modelId: 'ios',
        groupId: group.json().id,
        vars: { enablePassword: 'super-secret-enable' },
      },
    });
    deviceId = device.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores enablePassword encrypted, never plaintext', async () => {
    const [row] = await app.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row?.vars.enablePassword).toBeUndefined();
    expect(typeof row?.vars.enablePasswordEnc).toBe('string');
    expect(JSON.stringify(row?.vars)).not.toContain('super-secret-enable');
  });

  it('API responses mask the secret as enablePasswordSet', async () => {
    for (const url of [
      `/api/v1/orgs/${orgId}/devices`,
      `/api/v1/orgs/${orgId}/devices/${deviceId}`,
    ]) {
      const res = await app.inject({ method: 'GET', url, cookies: cookie });
      const device = Array.isArray(res.json()) ? res.json()[0] : res.json();
      expect(device.vars.enablePasswordSet).toBe(true);
      expect(device.vars.enablePassword).toBeUndefined();
      expect(device.vars.enablePasswordEnc).toBeUndefined();
    }
  });

  it('PATCH without the var preserves it; empty string clears it', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}`,
      cookies: cookie,
      payload: { vars: { enablePasswordSet: true, other: 'kept' } },
    });
    let [row] = await app.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(typeof row?.vars.enablePasswordEnc).toBe('string');
    expect(row?.vars.other).toBe('kept');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}`,
      cookies: cookie,
      payload: { vars: { enablePassword: '' } },
    });
    [row] = await app.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row?.vars.enablePasswordEnc).toBeUndefined();
  });
});
