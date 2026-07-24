import { mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { type Keyring, loadKeyring } from './auth/keyring.js';

/**
 * Bootstrap configuration only — everything else lives in the database and is
 * managed through the web UI. Env vars are read once at startup.
 */
export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Versioned keys for AES-256-GCM encryption of secrets at rest. */
  keyring: Keyring;
  /** Postgres connection string; when unset, embedded PGlite is used. */
  databaseUrl: string | undefined;
  pgliteDir: string;
  reposDir: string;
  driversDir: string;
  logLevel: string;
  /** Number of collector worker threads (minimum 1). */
  collectorPoolSize: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = resolve(env.FE2O3_DATA_DIR ?? './.data');
  mkdirSync(dataDir, { recursive: true });

  const reposDir = join(dataDir, 'repos');
  const driversDir = join(dataDir, 'drivers');
  mkdirSync(reposDir, { recursive: true });
  mkdirSync(driversDir, { recursive: true });

  const keyring = loadKeyring(dataDir, env.FE2O3_SECRET_KEY);

  const poolDefault = Math.min(4, Math.max(1, cpus().length - 1));
  const collectorPoolSize = Math.max(
    1,
    Number(env.FE2O3_COLLECTOR_POOL_SIZE ?? poolDefault) || poolDefault,
  );

  return {
    port: Number(env.FE2O3_PORT ?? 8442),
    host: env.FE2O3_HOST ?? '0.0.0.0',
    dataDir,
    keyring,
    databaseUrl: env.FE2O3_DATABASE_URL,
    pgliteDir: join(dataDir, 'pg'),
    reposDir,
    driversDir,
    logLevel: env.FE2O3_LOG_LEVEL ?? 'info',
    collectorPoolSize,
  };
}
