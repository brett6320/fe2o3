import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'fe2o3_session');
  if (!c) throw new Error('no session cookie');
  return { fe2o3_session: c.value };
}

describe('hooks + csv import', () => {
  let app: FastifyInstance;
  let cookie: Record<string, string>;
  let orgId: string;
  let receiver: Server;
  const received: { body: string; signature: string | undefined }[] = [];
  let receiverPort: number;

  beforeAll(async () => {
    app = await buildTestApp();
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        received.push({ body, signature: req.headers['x-fe2o3-signature'] as string | undefined });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverPort = (receiver.address() as AddressInfo).port;

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
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/groups`,
      cookies: cookie,
      payload: { name: 'Core', pathSlug: 'core' },
    });
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  it('creates a hook and test-fires it with HMAC signature', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/hooks`,
      cookies: cookie,
      payload: {
        name: 'ci',
        type: 'webhook',
        events: ['backup_changed'],
        config: { url: `http://127.0.0.1:${receiverPort}/hook`, secret: 'shh' },
      },
    });
    expect(created.statusCode).toBe(200);

    const test = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/hooks/${created.json().id}/test`,
      cookies: cookie,
    });
    expect(test.json().ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(received[0]?.body ?? '{}').event).toBe('backup_changed');
  });

  it('imports devices from CSV, reporting skips', async () => {
    const csv = [
      'name,host,model,group,port,protocol',
      'r1,10.0.0.1,ios,core',
      'r2,10.0.0.2,ios,core,2222',
      'bad-model,10.0.0.3,doesnotexist,core',
      'bad-group,10.0.0.4,ios,nope',
      'r1,10.0.0.5,ios,core', // duplicate name
    ].join('\n');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/devices/import`,
      cookies: cookie,
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(2);
    expect(res.json().skipped).toHaveLength(3);

    const devices = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/devices`,
      cookies: cookie,
    });
    expect(devices.json()).toHaveLength(2);
    expect(devices.json().find((d: { name: string }) => d.name === 'r2').port).toBe(2222);
  });
});
