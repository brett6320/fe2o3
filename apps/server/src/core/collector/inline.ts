import { runBackup } from '../executor.js';
import type { DriverRegistry } from '../models/registry.js';
import type { Collector, CollectResult, CollectTask } from './types.js';

/**
 * Runs the collection on the main thread. Used as the test seam and as a
 * fallback when the worker pool is unavailable. `run` never rejects — a broken
 * driver or a failed session comes back as `ok:false`.
 */
export class InlineCollector implements Collector {
  constructor(private registry: DriverRegistry) {}

  async run(task: CollectTask): Promise<CollectResult> {
    const driver = this.registry.get(task.driverId);
    if (!driver) return { ok: false, error: `unknown driver model: ${task.driverId}` };
    try {
      const { configText, transcript } = await runBackup({
        driver,
        protocol: task.protocol,
        connect: task.connect,
        enablePassword: task.enablePassword,
      });
      return { ok: true, configText, transcript };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {}
}
