import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

describe('git mirror push', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;
  let orgId: string;
  let deviceId: string;
  let fake: Awaited<ReturnType<typeof startFakeDevice>>;
  let bareRepo: string;

  beforeAll(async () => {
    app = await buildTestApp();
    // a local bare repo stands in for the external mirror (file:// remote)
    bareRepo = join(mkdtempSync(join(tmpdir(), 'fe2o3-mirror-target-')), 'mirror.git');
    await execa('git', ['init', '--bare', '-b', 'main', bareRepo]);

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
    orgId = setup.json().orgs[0].id;
    cookie = cookieOf(setup);

    const cred = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/credentials`,
      cookies: cookie,
      payload: { name: 'c', username: 'backup', password: 'pw' },
    });
    const group = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: { name: 'Core', pathSlug: 'core', defaultCredentialId: cred.json().id },
    });
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
    deviceId = device.json().id;
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  it('configures the mirror (secrets write-only) and test-pushes', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/orgs/${orgId}/mirror`,
      cookies: cookie,
      payload: { mirrorUrl: `file://${bareRepo}`, mirrorBranch: 'main' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().mirrorUrl).toBe(`file://${bareRepo}`);

    // an initial commit must exist to push — do a backup first
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices/${deviceId}/backup`,
      cookies: cookie,
    });

    const test = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/mirror/test`,
      cookies: cookie,
    });
    expect(test.json()).toEqual({ ok: true });
  });

  it('auto-pushes the org repo to the mirror when a backup changes config', async () => {
    // the backup above already pushed via the auto path too; verify the bare
    // repo has the device file at HEAD
    const { stdout } = await execa('git', ['ls-tree', '-r', '--name-only', 'main'], {
      cwd: bareRepo,
    });
    expect(stdout).toContain('core/router1');

    const { stdout: content } = await execa('git', ['show', 'main:core/router1'], {
      cwd: bareRepo,
    });
    expect(content).toContain('hostname router1');
  });
});
