import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';

const config = loadConfig();
const db = await createDb({
  databaseUrl: config.databaseUrl,
  pgliteDataDir: config.pgliteDir,
});
const app = await buildApp({ config, db });

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
