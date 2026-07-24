import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('cross-org move', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;
  let fake: Awaited<ReturnType<typeof startFakeDevice>>;
  let orgA: string;
  let orgB: string;
  let groupBId: string;
  let deviceId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    fake = await startFakeDevice({
      prompt: 'router1#',
      username: 'backup',
      password: 'pw',
      responses: {
        'terminal length 0': '',
        'terminal width 0': '',
        'show version': 'Cisco IOS 15.2',
        'show inventory': 'NAME: chassis',
        'show running-config': 'hostname router1\nend',
      },
    });

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
    orgA = setup.json().orgs[0].id;
    cookie = cookieOf(setup);

    const orgBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      cookies: cookie,
      payload: { name: 'Globex', slug: 'globex' },
    });
    orgB = orgBRes.json().id;

    const credA = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/credentials`,
      cookies: cookie,
      payload: { name: 'lab', username: 'backup', password: 'pw' },
    });
    const groupA = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/groups`,
      cookies: cookie,
      payload: { name: 'Core', pathSlug: 'core', defaultCredentialId: credA.json().id },
    });
    const groupB = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgB}/groups`,
      cookies: cookie,
      payload: { name: 'Edge', pathSlug: 'edge' },
    });
    groupBId = groupB.json().id;

    const device = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/devices`,
      cookies: cookie,
      payload: {
        name: 'router1',
        host: '127.0.0.1',
        port: fake.port,
        modelId: 'ios',
        groupId: groupA.json().id,
        credentialId: credA.json().id,
        backupNow: false,
      },
    });
    deviceId = device.json().id;

    // give it a backed-up config so there is something to move across repos
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/devices/${deviceId}/backup`,
      cookies: cookie,
    });
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  it('moves a device to another org: config crosses repos, credential cleared', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/devices/${deviceId}/move`,
      cookies: cookie,
      payload: { toOrgId: orgB, toGroupId: groupBId },
    });
    expect(res.statusCode).toBe(200);

    // device now belongs to org B, group B, with no credential
    const dev = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgB}/devices/${deviceId}`,
      cookies: cookie,
    });
    expect(dev.statusCode).toBe(200);
    expect(dev.json().groupId).toBe(groupBId);
    expect(dev.json().credentialId).toBeNull();

    // gone from org A
    const goneA = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgA}/devices/${deviceId}`,
      cookies: cookie,
    });
    expect(goneA.statusCode).toBe(404);

    // config file is in org B's repo and removed from org A's
    const bContent = await readFile(join(app.config.reposDir, 'globex', 'edge', 'router1'), 'utf8');
    expect(bContent).toContain('hostname router1');
    const aList = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
      cwd: join(app.config.reposDir, 'acme'),
    });
    expect(aList.stdout).not.toContain('router1');

    // jobs followed the device into org B
    const jobsB = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgB}/devices/${deviceId}/jobs`,
      cookies: cookie,
    });
    expect(jobsB.json().length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a move when the name collides in the target org', async () => {
    // create a colliding device in org B
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgB}/devices`,
      cookies: cookie,
      payload: { name: 'dup', host: '10.0.0.9', modelId: 'ios', groupId: groupBId },
    });
    // and one named 'dup' back in org A
    const groupA2 = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/groups`,
      cookies: cookie,
      payload: { name: 'G2', pathSlug: 'g2' },
    });
    const dupA = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/devices`,
      cookies: cookie,
      payload: { name: 'dup', host: '10.0.0.10', modelId: 'ios', groupId: groupA2.json().id },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgA}/devices/${dupA.json().id}/move`,
      cookies: cookie,
      payload: { toOrgId: orgB, toGroupId: groupBId },
    });
    expect(res.statusCode).toBe(409);
  });
});
