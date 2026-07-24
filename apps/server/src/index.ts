import pino from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { InlineCollector } from './core/collector/inline.js';
import { CollectorPool } from './core/collector/pool.js';
import { WorkerCollector } from './core/collector/worker-collector.js';
import { startHookDispatcher } from './core/hooks/dispatcher.js';
import { DriverRegistry } from './core/models/registry.js';
import { Scheduler } from './core/scheduler.js';
import { createDb } from './db/index.js';

const config = loadConfig();
const bootLog = pino({ level: config.logLevel });
const db = await createDb({
  databaseUrl: config.databaseUrl,
  pgliteDataDir: config.pgliteDir,
  log: bootLog,
});

// One shared registry for the app and the pool's inline fallback.
const registry = new DriverRegistry();
await registry.loadPlugins(config.driversDir);

// Collector pool: the long-running SSH/telnet sessions run on worker threads,
// isolating a runaway parse/scrub from the API event loop. A worker crash falls
// back to inline collection so no backup is lost.
const pool = new CollectorPool({
  size: config.collectorPoolSize,
  createCollector: () => new WorkerCollector({ driversDir: config.driversDir, log: bootLog }),
  fallback: new InlineCollector(registry),
  log: bootLog,
});
bootLog.info({ size: pool.size }, 'collector pool started');

const app = await buildApp({ config, db, pool, registry });

startHookDispatcher(db, app.bus, app.log);

const scheduler = new Scheduler({
  db,
  config,
  registry: app.registry,
  bus: app.bus,
  pool,
  log: app.log,
});

// Last-resort safety net: a transient DB/network error must never crash the
// backup daemon. Log unhandled rejections instead of letting Node exit.
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandled promise rejection (kept alive)');
});

try {
  await app.listen({ port: config.port, host: config.host });
  await scheduler.start();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await scheduler.stop();
      await pool.close();
      await app.close();
      process.exit(0);
    })();
  });
}
