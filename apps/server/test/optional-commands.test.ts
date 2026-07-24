import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import ios from '../src/core/models/ios.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

describe('optional commands', () => {
  it('skips an unsupported optional command instead of failing the backup', async () => {
    const fake = await startFakeDevice({
      prompt: 'sw1#',
      username: 'backup',
      password: 'pw',
      responses: {
        'terminal length 0': '',
        'terminal width 0': '',
        'show version': 'Cisco IOS 12.2',
        // older switch: no inventory support -> device replies with an error
        'show inventory': "% Invalid input detected at '^' marker.",
        'show running-config': 'hostname sw1\nend',
      },
    });
    try {
      const result = await runBackup({
        driver: ios,
        connect: { host: '127.0.0.1', port: fake.port, username: 'backup', password: 'pw' },
      });
      // backup succeeds using the critical commands
      expect(result.configText).toContain('hostname sw1');
      expect(result.configText).toContain('Cisco IOS 12.2');
      // the unsupported section is omitted, not an error
      expect(result.configText).not.toContain('Invalid input');
    } finally {
      await fake.close();
    }
  }, 20000);

  it('still fails when a required command errors', async () => {
    const fake = await startFakeDevice({
      prompt: 'sw1#',
      username: 'backup',
      password: 'pw',
      responses: {
        'terminal length 0': '',
        'terminal width 0': '',
        'show version': 'Cisco IOS 12.2',
        'show inventory': 'NAME: chassis',
        'show running-config': "% Invalid input detected at '^' marker.",
      },
    });
    try {
      await expect(
        runBackup({
          driver: ios,
          connect: { host: '127.0.0.1', port: fake.port, username: 'backup', password: 'pw' },
        }),
      ).rejects.toThrow(/running-config/);
    } finally {
      await fake.close();
    }
  }, 20000);
});
