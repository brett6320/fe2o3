import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('health', () => {
  it('reports ok with version and uptime', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
    await app.close();
  });
});
