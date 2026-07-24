import pino from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startHookDispatcher } from './core/hooks/dispatcher.js';
import { Scheduler } from './core/scheduler.js';
import { createDb } from './db/index.js';

const config = loadConfig();
const bootLog = pino({ level: config.logLevel });
const db = await createDb({
  databaseUrl: config.databaseUrl,
  pgliteDataDir: config.pgliteDir,
  log: bootLog,
});
const app = await buildApp({ config, db });

startHookDispatcher(db, app.bus, app.log);

const scheduler = new Scheduler({
  db,
  config,
  registry: app.registry,
  bus: app.bus,
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
      await app.close();
      process.exit(0);
    })();
  });
}
