import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import linux from '../src/core/models/linux.js';
import { startFakeTelnetDevice } from './fixtures/fake-telnet-server.js';

describe('telnet transport', () => {
  it('logs in and runs a backup over telnet', async () => {
    const fake = await startFakeTelnetDevice({
      prompt: 'vyos$',
      username: 'backup',
      password: 'pw',
      responses: {
        'uname -a': 'Linux vyos 6.1',
        'cat /etc/os-release 2>/dev/null || true': 'NAME=VyOS',
        'ip -o addr 2>/dev/null || ifconfig -a': '1: lo inet 127.0.0.1/8',
        'ip route 2>/dev/null || netstat -rn': 'default via 10.0.0.1',
      },
    });
    try {
      const result = await runBackup({
        driver: linux,
        protocol: 'telnet',
        connect: {
          host: '127.0.0.1',
          port: fake.port,
          username: 'backup',
          password: 'pw',
        },
      });
      expect(result.configText).toContain('Linux vyos');
      expect(result.configText).toContain('default via 10.0.0.1');
    } finally {
      await fake.close();
    }
  }, 15000);
});
