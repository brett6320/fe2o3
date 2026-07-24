import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Bootstrap configuration only — everything else lives in the database and is
 * managed through the web UI. Env vars are read once at startup.
 */
export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** 32-byte key (hex) for AES-256-GCM encryption of secrets at rest. */
  secretKey: Buffer;
  /** Postgres connection string; when unset, embedded PGlite is used. */
  databaseUrl: string | undefined;
  pgliteDir: string;
  reposDir: string;
  driversDir: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = resolve(env.FE2O3_DATA_DIR ?? './.data');
  mkdirSync(dataDir, { recursive: true });

  const reposDir = join(dataDir, 'repos');
  const driversDir = join(dataDir, 'drivers');
  mkdirSync(reposDir, { recursive: true });
  mkdirSync(driversDir, { recursive: true });

  let secretHex = env.FE2O3_SECRET_KEY;
  if (!secretHex) {
    const keyFile = join(dataDir, 'secret.key');
    if (existsSync(keyFile)) {
      secretHex = readFileSync(keyFile, 'utf8').trim();
    } else {
      secretHex = randomBytes(32).toString('hex');
      writeFileSync(keyFile, `${secretHex}\n`, { mode: 0o600 });
    }
  }
  const secretKey = Buffer.from(secretHex, 'hex');
  if (secretKey.length !== 32) {
    throw new Error('FE2O3_SECRET_KEY must be 64 hex chars (32 bytes)');
  }

  return {
    port: Number(env.FE2O3_PORT ?? 8442),
    host: env.FE2O3_HOST ?? '0.0.0.0',
    dataDir,
    secretKey,
    databaseUrl: env.FE2O3_DATABASE_URL,
    pgliteDir: join(dataDir, 'pg'),
    reposDir,
    driversDir,
    logLevel: env.FE2O3_LOG_LEVEL ?? 'info',
  };
}
