import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/executor.js';
import cradlepoint from '../src/core/models/cradlepoint.js';
import digi from '../src/core/models/digi.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

// These exercise the driver plumbing (session, section assembly, scrubbers)
// against fake devices modelled on the documented CLIs. The exact command set
// / prompt should still be validated against real hardware.

describe('cradlepoint NCOS driver', () => {
  it('backs up and scrubs JSON secrets', async () => {
    const config = `{
  "system": { "system_id": "IBR900-abc" },
  "wlan": { "radio": [ { "password": "super-secret-psk" } ] },
  "wan": { "api_key": "AK-12345" }
}`;
    const fake = await startFakeDevice({
      prompt: '[admin@IBR900-abc: /]$',
      username: 'admin',
      password: 'pw',
      responses: {
        'get status/product_info': '{ "product_name": "IBR900" }',
        'get config': config,
      },
    });
    try {
      const result = await runBackup({
        driver: cradlepoint,
        connect: { host: '127.0.0.1', port: fake.port, username: 'admin', password: 'pw' },
      });
      expect(result.configText).toContain('IBR900');
      expect(result.configText).not.toContain('super-secret-psk');
      expect(result.configText).not.toContain('AK-12345');
      expect(result.configText).toContain('<secret hidden>');
    } finally {
      await fake.close();
    }
  }, 20000);
});

describe('digi DAL driver', () => {
  it('backs up and scrubs config secrets', async () => {
    const fake = await startFakeDevice({
      prompt: 'admin@digi-wr64>',
      username: 'admin',
      password: 'pw',
      responses: {
        'show system': 'Model: Digi WR64\nFirmware: 22.2.9',
        'show config':
          'network interface wan\n  password mysecretpass\nvpn ipsec tunnel t1\n  pre_shared_key topsecretpsk',
      },
    });
    try {
      const result = await runBackup({
        driver: digi,
        connect: { host: '127.0.0.1', port: fake.port, username: 'admin', password: 'pw' },
      });
      expect(result.configText).toContain('Digi WR64');
      expect(result.configText).not.toContain('mysecretpass');
      expect(result.configText).not.toContain('topsecretpsk');
      expect(result.configText).toContain('<secret hidden>');
    } finally {
      await fake.close();
    }
  }, 20000);
});
