import { describe, expect, it } from 'vitest';
import { connectSsh } from '../src/core/input/ssh.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

describe('idle (not total) expect timeout', () => {
  it('keeps waiting while a large config streams past the timeout window', async () => {
    // 8 chunks, 250ms apart = ~2s of streaming, but each gap (250ms) is well
    // under the 1s expect timeout. A total-time timeout would fail at 1s; an
    // idle timeout succeeds because data keeps arriving.
    const chunks = Array.from({ length: 8 }, (_, i) => `line ${i} of big config\n`);
    const fake = await startFakeDevice({
      prompt: 'router>',
      username: 'u',
      password: 'p',
      responses: {},
      slowCommand: { cmd: 'show config', chunks, gapMs: 250 },
    });
    try {
      const t = await connectSsh({
        host: '127.0.0.1',
        port: fake.port,
        username: 'u',
        password: 'p',
        timeoutMs: 1000,
      });
      await t.expect(/router>\s?$/m); // initial prompt
      await t.send('show config');
      const out = await t.expect(/router>\s?$/m); // 1s idle timeout, ~2s stream
      expect(out).toContain('line 0 of big config');
      expect(out).toContain('line 7 of big config');
      await t.close();
    } finally {
      await fake.close();
    }
  }, 15000);

  it('still times out when the device goes truly silent', async () => {
    const fake = await startFakeDevice({
      prompt: 'router>',
      username: 'u',
      password: 'p',
      // command with no configured response and not exit → device stays silent
      responses: {},
      slowCommand: { cmd: 'hang', chunks: ['partial output, then silence\n'], gapMs: 5000 },
    });
    try {
      const t = await connectSsh({
        host: '127.0.0.1',
        port: fake.port,
        username: 'u',
        password: 'p',
        timeoutMs: 700,
      });
      await t.expect(/router>\s?$/m);
      await t.send('hang');
      // first chunk arrives, then a 5s gap with no data → idle timeout at ~700ms
      await expect(t.expect(/router>\s?$/m)).rejects.toThrow(/timed out/);
      await t.close();
    } finally {
      await fake.close();
    }
  }, 15000);
});
