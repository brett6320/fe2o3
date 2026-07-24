import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import routeros from '../src/core/models/routeros.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

const BANNER = `******************************************************************
* This is a restricted-access system. Disconnect immediately if  *
* you are not authorized.                                         *
******************************************************************

NGEN Networks, LLC
RouterOS`;

const EXPORT = `# jul/24/2026 10:00:00 by RouterOS 7.15
# software id = ABCD-EFGH
/interface bridge
add name=br0
/ip address
add address=10.0.0.1/24 interface=br0`;

describe('routeros driver', () => {
  it('backs up over a CR-terminated CLI after a login banner', async () => {
    const fake = await startFakeDevice({
      prompt: '[oxidized@NGENRouter-CSC2500-GARAGE] >',
      username: 'oxidized',
      password: 'pw',
      banner: BANNER,
      requireCr: true, // RouterOS only submits on carriage return
      responses: { '/export': EXPORT },
    });
    try {
      const result = await runBackup({
        driver: routeros,
        connect: { host: '127.0.0.1', port: fake.port, username: 'oxidized', password: 'pw' },
      });
      expect(result.configText).toContain('add name=br0');
      expect(result.configText).toContain('10.0.0.1/24');
      // volatile header lines are scrubbed
      expect(result.configText).not.toContain('by RouterOS');
      expect(result.configText).not.toContain('software id');
    } finally {
      await fake.close();
    }
  }, 20000);

  it('would hang on a CR-only device if commands were sent with just \\n', async () => {
    // prove the line-ending matters: a driver sending \n against a CR-only
    // device times out (this is the bug that was reported).
    const fake = await startFakeDevice({
      prompt: '[admin@mt] >',
      username: 'oxidized',
      password: 'pw',
      requireCr: true,
      responses: { '/export': '/interface bridge' },
    });
    try {
      await expect(
        runBackup({
          driver: { ...routeros, lineEnding: '\n' },
          connect: {
            host: '127.0.0.1',
            port: fake.port,
            username: 'oxidized',
            password: 'pw',
            timeoutMs: 2500,
          },
        }),
      ).rejects.toThrow(/timed out/);
    } finally {
      await fake.close();
    }
  }, 20000);
});
