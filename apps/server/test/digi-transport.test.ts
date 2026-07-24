import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import digiTransport from '../src/core/models/digi-transport.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

// Excerpt of a real `config c show` from a Digi TransPort unit.
const RUNNING = `eth 0 IPaddr "172.23.133.17"
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
      responses: {
        ati: 'Digi TransPort WR21',
        'config c show': RUNNING,
        'config 0 show': SAVED,
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
      // the OK terminator is dropped
      expect(result.configText).not.toMatch(/^OK$/m);
      // non-secret config is preserved
      expect(result.configText).toContain('user 1 name "oxidized"');
    } finally {
      await fake.close();
    }
  }, 20000);
});
