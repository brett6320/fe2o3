import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** Driver-agnostic handle — node-postgres in production, PGlite embedded. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * `FE2O3_DATABASE_URL` set → real Postgres (production).
 * Unset → embedded PGlite stored under the data dir (dev / small installs).
 * Tests pass `pgliteDataDir: 'memory://'` for a throwaway in-memory instance.
 */
export interface CreateDbOptions {
  databaseUrl?: string | undefined;
  pgliteDataDir?: string;
  /** Startup retry attempts (Postgres only); default 15. */
  connectRetries?: number;
  /** Delay between retries in ms; default 2000. */
  connectRetryDelayMs?: number;
  log?: { info?: (o: unknown, m: string) => void; warn?: (o: unknown, m: string) => void };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transient conditions during container/DB startup that a retry can clear. */
function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  // ECONNREFUSED (db not listening yet), 57P03 (starting up),
  // 28P01/28000 (auth) — the password can lag behind pg_isready during the
  // entrypoint's temporary-server → real-server restart on a fresh volume.
  const transient = new Set([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    '57P03',
    '28P01',
    '28000',
    '53300',
  ]);
  return transient.has(code ?? '') || transient.has(causeCode ?? '');
}

export async function createDb(opts: CreateDbOptions): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    // Idle-client errors (e.g. Postgres closing a connection during a restart)
    // are emitted on the pool; without a listener Node treats them as unhandled
    // and crashes. Log and let the pool re-establish connections on demand.
    pool.on('error', (err) => opts.log?.warn?.({ err }, 'postgres pool client error'));
    const db = drizzlePg(pool, { schema });
    const retries = opts.connectRetries ?? 15;
    const delay = opts.connectRetryDelayMs ?? 2000;
    for (let attempt = 1; ; attempt++) {
      try {
        await migratePg(db, { migrationsFolder });
        return db;
      } catch (err) {
        if (attempt > retries || !isTransientDbError(err)) throw err;
        opts.log?.warn?.(
          { attempt, retries, err: (err as Error).message },
          'database not ready, retrying startup',
        );
        await sleep(delay);
      }
    }
  }
  const pglite = new PGlite(opts.pgliteDataDir ?? 'memory://');
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}
