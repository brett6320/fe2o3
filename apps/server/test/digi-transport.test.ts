import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import digiTransport from '../src/core/models/digi-transport.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';
import { startFakeTelnetDevice } from './fixtures/fake-telnet-server.js';

// Excerpt of a real `config c show` from a Digi TransPort unit.
const RUNNING = `\u0000eth 0 IPaddr "172.23.133.17"
eth 0 mask "255.255.255.248"
route 0 descr "CAN-2501"
eroute 0 authmeth "PRESHARED"
user 0 name "bmeier"
user 0 epassword "Oy13Xg5hH09CSA=="
user 0 access 0
user 1 name "oxidized"
user 1 epassword "PjFTF2N+QXBKb3szDwlbUictLEZ5fjFx"
user 1 access 8
user 11 epassword "KydiYlQbEUZjTkg5YQtGM1g2BQF1VSdeDGxyV1M+bUg="
user 11 enewpwd "KydiYlQbEUZjTkg5YQtGM1g2BQF1VSdeDGxyV1M+bUg="
provision 0 string1 "123456"
cloud 0 epwd "CzRvUkxLTwgADA=="

OK`;

const SAVED = `eth 0 IPaddr "172.23.133.17"
user 0 epassword "Oy13Xg5hH09CSA=="

OK`;

describe('digi transport driver', () => {
  it('captures running + saved config over a CR CLI and scrubs encrypted passwords', async () => {
    const fake = await startFakeDevice({
      prompt: 'ss345898>',
      username: 'oxidized',
      password: 'pw',
      requireCr: true, // AT-command CLI submits on carriage return
      suppressCommandPrompt: true, // Sarian sends no prompt after a command
      responses: {
        ati: 'Digi TransPort WR21\nOK',
        hw: 'Serial Number: 345898\nHW Rev: 1203b\nMAC 0: 00:04:2d:05:47:2a\nModel: WR21\nPart#: WR21-L51B-DE1-XX\nRAM: 128 MB\nOK',
        'config c show': RUNNING,
        'config 0 show': SAVED,
        uptime: 'Uptime 96 Hrs 0 Mins 12 Seconds\nOK',
      },
    });
    try {
      const result = await runBackup({
        driver: digiTransport,
        connect: { host: '127.0.0.1', port: fake.port, username: 'oxidized', password: 'pw' },
      });
      // config captured, both sections labelled
      expect(result.configText).toContain('eth 0 IPaddr "172.23.133.17"');
      expect(result.configText).toContain('running-config');
      expect(result.configText).toContain('saved-config');
      expect(result.configText).toContain('Digi TransPort WR21');
      // every encrypted secret scrubbed
      expect(result.configText).not.toContain('Oy13Xg5hH09CSA==');
      expect(result.configText).not.toContain('PjFTF2N+QXBKb3szDwlbUictLEZ5fjFx');
      expect(result.configText).not.toContain('KydiYlQbEUZjTkg5YQtGM1g2BQF1VSdeDGxyV1M+bUg=');
      expect(result.configText).not.toContain('CzRvUkxLTwgADA==');
      expect(result.configText).toContain('<secret hidden>');
      // NUL bytes (Sarian emits them) are stripped — Postgres text rejects 0x00
      expect(result.configText).not.toContain('\u0000');
      expect(result.transcript).not.toContain('\u0000');
      // the OK terminator is dropped
      expect(result.configText).not.toMatch(/^OK$/m);
      // non-secret config is preserved
      expect(result.configText).toContain('user 1 name "oxidized"');
      // uptime captured as a stat (from the `uptime` command), not in config
      expect(result.uptimeSeconds).toBe(96 * 3600 + 12);
      expect(result.configText).not.toContain('Uptime 96 Hrs');
      // hardware facts parsed from the `hw` command output
      const facts = digiTransport.facts?.(result.configText);
      expect(facts?.serial).toBe('345898');
      expect(facts?.model).toBe('WR21');
      expect(facts?.inventory?.[0]?.pid).toBe('WR21-L51B-DE1-XX');
    } finally {
      await fake.close();
    }
  }, 20000);
  it('also works over telnet (Sarian ends commands on OK, no prompt)', async () => {
    const fake = await startFakeTelnetDevice({
      prompt: 'ss345898>',
      username: 'oxidized',
      password: 'pw',
      suppressCommandPrompt: true,
      responses: {
        ati: 'Digi TransPort WR21\nOK',
        hw: 'Serial Number: 345898\nHW Rev: 1203b\nMAC 0: 00:04:2d:05:47:2a\nModel: WR21\nPart#: WR21-L51B-DE1-XX\nRAM: 128 MB\nOK',
        'config c show': RUNNING,
        'config 0 show': SAVED,
        uptime: 'Uptime 96 Hrs 0 Mins 12 Seconds\nOK',
      },
    });
    try {
      const result = await runBackup({
        driver: digiTransport,
        protocol: 'telnet',
        connect: { host: '127.0.0.1', port: fake.port, username: 'oxidized', password: 'pw' },
      });
      expect(result.configText).toContain('eth 0 IPaddr "172.23.133.17"');
      expect(result.configText).toContain('running-config');
      expect(result.configText).toContain('saved-config');
      expect(result.configText).not.toContain('Oy13Xg5hH09CSA==');
      expect(result.configText).toContain('<secret hidden>');
    } finally {
      await fake.close();
    }
  }, 20000);
});
