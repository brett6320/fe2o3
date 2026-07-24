import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';
import { buildTestApp } from './helpers.js';

const RUNNING_CONFIG = `Building configuration...
Current configuration : 1278 bytes
!
hostname router1
!
enable secret 5 $1$abcd$SECRETHASH
username admin privilege 15 secret 5 $1$wxyz$OTHERHASH
!
snmp-server community s3cr3tRO RO
ntp clock-period 17208078
!
interface GigabitEthernet0/0
 ip address 192.0.2.1 255.255.255.0
!
end`;

const fakeDevice = {
  prompt: 'router1#',
  username: 'backup',
  password: 'device-pass',
  responses: {
    'terminal length 0': '',
    'terminal width 0': '',
    'show version': 'Cisco IOS Software, Version 15.2(4)M6',
    'show inventory': 'NAME: "Chassis", DESCR: "Fake 2901"',
    'show running-config': RUNNING_CONFIG,
  },
};

describe('backup engine e2e', () => {
  let app: FastifyInstance;
  let fake: Awaited<ReturnType<typeof startFakeDevice>>;
  let cookie: Record<string, string>;
  let orgId: string;
  let deviceId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    fake = await startFakeDevice(fakeDevice);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        email: 'admin@example.com',
        password: 'correct-horse-battery',
        displayName: 'Admin',
        orgName: 'Acme',
        orgSlug: 'acme',
      },
    });
    orgId = setup.json().orgs[0].id;
    const c = setup.cookies.find((c: { name: string }) => c.name === 'fe2o3_session');
    cookie = { fe2o3_session: c?.value ?? '' };

    const cred = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/credentials`,
      cookies: cookie,
      payload: { name: 'lab', username: fakeDevice.username, password: fakeDevice.password },
    });
    expect(cred.statusCode).toBe(200);
    expect(cred.json().hasPassword).toBe(true);

    const group = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: { name: 'Core', pathSlug: 'core', defaultCredentialId: cred.json().id },
    });
    expect(group.statusCode).toBe(200);

    const device = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
      payload: {
        name: 'router1',
        host: '127.0.0.1',
        port: fake.port,
        modelId: 'ios',
        groupId: group.json().id,
      },
    });
    expect(device.statusCode).toBe(200);
    deviceId = device.json().id;
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  it('backs up a device over ssh, commits scrubbed config to git', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}/backup`,
      cookies: cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).toBeUndefined();
    expect(body.status).toBe('success');
    expect(body.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // stored file contains config but not secrets or volatile lines
    const repoDir = join(app.config.reposDir, 'acme');
    const content = await readFile(join(repoDir, 'core', 'router1'), 'utf8');
    expect(content).toContain('hostname router1');
    expect(content).toContain('Cisco IOS Software');
    expect(content).toContain('<secret hidden>');
    expect(content).not.toContain('SECRETHASH');
    expect(content).not.toContain('s3cr3tRO');
    expect(content).not.toContain('ntp clock-period');
    expect(content).not.toContain('Building configuration');

    const { stdout } = await execa('git', ['log', '--format=%s'], { cwd: repoDir });
    expect(stdout).toContain('router1: backup (manual)');
  });

  it('second identical backup creates no new commit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}/backup`,
      cookies: cookie,
    });
    expect(res.json().status).toBe('success');
    expect(res.json().commitSha).toBeNull();
  });

  it('serves versions, content, and jobs via the API', async () => {
    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}/versions`,
      cookies: cookie,
    });
    expect(versions.statusCode).toBe(200);
    expect(versions.json()).toHaveLength(1);
    const sha = versions.json()[0].sha;

    const version = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}/versions/${sha}`,
      cookies: cookie,
    });
    expect(version.statusCode).toBe(200);
    expect(version.json().content).toContain('hostname router1');

    const jobsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}/jobs`,
      cookies: cookie,
    });
    expect(jobsRes.statusCode).toBe(200);
    expect(jobsRes.json().length).toBeGreaterThanOrEqual(2);
    expect(jobsRes.json().every((j: { status: string }) => j.status === 'success')).toBe(true);
  });

  it('records a failed job when the device is unreachable', async () => {
    const group = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
    });
    const dead = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
      payload: {
        name: 'unreachable',
        host: '127.0.0.1',
        port: 1, // nothing listens here
        modelId: 'ios',
        groupId: group.json()[0].id,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices/${dead.json().id}/backup`,
      cookies: cookie,
    });
    expect(res.json().status).toBe('failed');
    expect(res.json().error).toBeTruthy();
  });
});
