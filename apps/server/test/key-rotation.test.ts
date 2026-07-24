import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blobKeyId, decryptSecret } from '../src/auth/crypto.js';
import { credentials, devices, users } from '../src/db/schema.js';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('symmetric key rotation', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;
  let orgId: string;

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

    // seed one of every encrypted thing
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/credentials`,
      cookies: cookie,
      payload: { name: 'c', username: 'u', password: 'device-pw', enablePassword: 'enable-pw' },
    });
    await app.inject({ method: 'POST', url: '/api/v1/profile/totp/enroll', cookies: cookie });
    const group = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: { name: 'G', pathSlug: 'g' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
      payload: {
        name: 'r1',
        host: '10.0.0.1',
        modelId: 'ios',
        groupId: group.json().id,
        vars: { enablePassword: 'var-enable-pw' },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rotates every stored secret to the new key and stays decryptable', async () => {
    expect(app.config.keyring.activeId).toBe('1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/keys/rotate',
      cookies: cookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().activeKeyId).toBe('2');
    expect(res.json().rotated).toEqual({ credentialSecrets: 2, totpSecrets: 1, deviceVars: 1 });

    const [cred] = await app.db.select().from(credentials);
    const [user] = await app.db.select().from(users);
    const [device] = await app.db.select().from(devices);
    for (const blob of [
      cred?.passwordEnc,
      cred?.enablePasswordEnc,
      user?.totpSecretEnc,
      device?.vars.enablePasswordEnc as string,
    ]) {
      expect(blob && blobKeyId(blob)).toBe('2');
    }
    expect(cred?.passwordEnc && decryptSecret(cred.passwordEnc, app.config.keyring)).toBe(
      'device-pw',
    );
    expect(
      device?.vars.enablePasswordEnc &&
        decryptSecret(device.vars.enablePasswordEnc as string, app.config.keyring),
    ).toBe('var-enable-pw');
  });

  it('lists keys, refuses deleting the active key, deletes retired keys', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/keys', cookies: cookie });
    expect(list.json()).toEqual({ activeKeyId: '2', keyIds: ['1', '2'] });

    const denied = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/keys/2',
      cookies: cookie,
    });
    expect(denied.statusCode).toBe(400);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/keys/1',
      cookies: cookie,
    });
    expect(removed.statusCode).toBe(200);

    // everything still decrypts with only the new key in the ring
    const [cred] = await app.db.select().from(credentials);
    expect(cred?.passwordEnc && decryptSecret(cred.passwordEnc, app.config.keyring)).toBe(
      'device-pw',
    );
  });

  it('requires superadmin', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/v1/admin/keys/rotate' });
    expect(anon.statusCode).toBe(401);
  });

  it('second rotation increments the key id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/keys/rotate',
      cookies: cookie,
    });
    expect(res.json().activeKeyId).toBe('3');
  });
});
