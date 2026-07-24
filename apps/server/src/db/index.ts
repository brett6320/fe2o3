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
}

export async function createDb(opts: CreateDbOptions): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return db;
  }
  const pglite = new PGlite(opts.pgliteDataDir ?? 'memory://');
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}
