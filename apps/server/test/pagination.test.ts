import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import ios from '../src/core/models/ios.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

describe('--More-- pagination', () => {
  it('pages through a long login banner and paged command output', async () => {
    const fake = await startFakeDevice({
      prompt: 'router1#',
      username: 'backup',
      password: 'pw',
      bannerPages: [
        'distributors and users are responsible for\ncompliance with U.S. and local country laws.',
        'By using this product you agree to comply\nwith applicable laws and regulations.',
        'Final banner page.',
      ],
      responses: {
        'terminal length 0': '',
        'terminal width 0': '',
        'show version': 'Cisco IOS Software, Version 15.2(4)M6',
        'show inventory': ['NAME: "Chassis", DESCR: "Fake 2901"', 'PID: FAKE-2901, VID: V01'],
        'show running-config': 'hostname router1\nend',
      },
    });
    try {
      const result = await runBackup({
        driver: ios,
        connect: { host: '127.0.0.1', port: fake.port, username: 'backup', password: 'pw' },
      });
      expect(result.configText).toContain('hostname router1');
      // both pages of the paged command made it into the output
      expect(result.configText).toContain('Fake 2901');
      expect(result.configText).toContain('PID: FAKE-2901');
      // pagination artifacts are scrubbed
      expect(result.configText).not.toContain('--More--');
      expect(result.transcript).toContain('compliance with U.S.');
    } finally {
      await fake.close();
    }
  }, 20000);
});
