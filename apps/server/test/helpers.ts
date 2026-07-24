import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadKeyring } from '../src/auth/keyring.js';
import type { AppConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';

/** Build an app instance backed by a throwaway in-memory PGlite database. */
export async function buildTestApp() {
  const dataDir = mkdtempSync(join(tmpdir(), 'fe2o3-test-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    keyring: loadKeyring(dataDir),
    databaseUrl: undefined,
    pgliteDir: 'memory://',
    reposDir: join(dataDir, 'repos'),
    driversDir: join(dataDir, 'drivers'),
    logLevel: 'silent',
  };
  const db = await createDb({ pgliteDataDir: 'memory://' });
  const app = await buildApp({ config, db });
  return app;
}
