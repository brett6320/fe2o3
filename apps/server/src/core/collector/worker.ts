/**
 * Collector worker entry point — runs inside a worker_thread.
 *
 * A "dumb" collector: it holds no DB, keyring, or git state. It builds its own
 * driver registry (built-ins + any file plugins), then for each CollectTask it
 * runs the SSH/telnet session and posts back the config + transcript. All
 * scheduling, persistence, and git work stays on the main thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { runBackup } from '../executor.js';
import { DriverRegistry } from '../models/registry.js';
import type { CollectResult, CollectTask } from './types.js';

const port = parentPort;
if (!port) throw new Error('collector worker started without a parent port');

// Build the registry once; plugins are re-imported here (driver specs carry
// live functions and can't be passed across the thread boundary).
const registryReady: Promise<DriverRegistry> = (async () => {
  const registry = new DriverRegistry();
  const driversDir = (workerData as { driversDir?: string } | undefined)?.driversDir;
  if (driversDir) await registry.loadPlugins(driversDir);
  return registry;
})();

port.on('message', (msg: { type: string; task?: CollectTask }) => {
  if (msg?.type !== 'collect' || !msg.task) return;
  const task = msg.task;
  void (async () => {
    let result: CollectResult;
    try {
      const registry = await registryReady;
      const driver = registry.get(task.driverId);
      if (!driver) {
        result = { ok: false, error: `unknown driver model: ${task.driverId}` };
      } else {
        const { configText, transcript, uptimeSeconds } = await runBackup({
          driver,
          protocol: task.protocol,
          connect: task.connect,
          enablePassword: task.enablePassword,
        });
        result = { ok: true, configText, transcript, uptimeSeconds };
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    port.postMessage({ type: 'result', jobId: task.jobId, result });
  })();
});
