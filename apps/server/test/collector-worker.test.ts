import { describe, expect, it } from 'vitest';
import { WorkerCollector } from '../src/core/collector/worker-collector.js';
import { startFakeDevice } from './fixtures/fake-ssh-server.js';

const fakeSpec = {
  prompt: 'sw1#',
  username: 'backup',
  password: 'pw',
  responses: {
    'terminal length 0': '',
    'terminal width 0': '',
    'show version': 'FakeOS 1.0',
    'show inventory': 'NAME: fake',
    'show running-config': 'hostname sw1\nend',
  },
};

// Exercises the full worker substrate: spawns a real worker_thread (with the tsx
// loader bootstrap), runs the executor there, and returns the config to the main
// thread. If the tsx bootstrap breaks, this fails.
describe('WorkerCollector (real worker thread)', () => {
  it('collects a device config on a worker thread', async () => {
    const fake = await startFakeDevice(fakeSpec);
    const collector = new WorkerCollector({ driversDir: '/nonexistent-collector-drivers' });
    try {
      const result = await collector.run({
        jobId: 'j1',
        deviceId: 'd1',
        deviceName: 'sw1',
        driverId: 'ios',
        protocol: 'ssh',
        connect: { host: '127.0.0.1', port: fake.port, username: 'backup', password: 'pw' },
      });
      expect(result.ok).toBe(true);
      expect(result.configText).toContain('hostname sw1');
    } finally {
      await collector.close();
      await fake.close();
    }
  }, 20000);
});
