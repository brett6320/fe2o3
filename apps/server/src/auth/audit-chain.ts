import { asc, desc, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { sha256 } from './crypto.js';

/**
 * Tamper-evident audit writes: every entry's hash covers its own canonical
 * content plus the previous entry's hash, forming a chain. Editing or deleting
 * any historical row breaks every hash after it.
 *
 * Inserts are serialized through a promise chain — fe2o3 is single-process, so
 * this is enough to keep the chain linear without DB-level locking.
 */

export const GENESIS = 'genesis';

export interface AuditEntryInput {
  userId: string | null;
  apiKeyId: string | null;
  action: string;
  resource: string;
  detail: Record<string, unknown>;
  ip: string | null;
}

export function canonicalHash(
  prevHash: string,
  entry: AuditEntryInput & { id: string; createdAt: Date },
): string {
  return sha256(
    [
      prevHash,
      entry.id,
      entry.userId ?? '',
      entry.apiKeyId ?? '',
      entry.action,
      entry.resource,
      JSON.stringify(entry.detail),
      entry.ip ?? '',
      entry.createdAt.toISOString(),
    ].join('|'),
  );
}

let chain: Promise<unknown> = Promise.resolve();

export function appendAudit(db: Db, input: AuditEntryInput): Promise<void> {
  const next = chain.then(
    () => write(db, input),
    () => write(db, input),
  );
  chain = next.catch(() => {});
  return next;
}

async function write(db: Db, input: AuditEntryInput): Promise<void> {
  const [last] = await db
    .select({ entryHash: auditLog.entryHash })
    .from(auditLog)
    .where(isNotNull(auditLog.entryHash))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  const prevHash = last?.entryHash ?? GENESIS;
  const id = nanoid();
  const createdAt = new Date();
  const entryHash = canonicalHash(prevHash, { ...input, id, createdAt });
  await db.insert(auditLog).values({
    id,
    ...input,
    prevHash,
    entryHash,
    createdAt,
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** Rows written before hash chaining existed (no hash); informational. */
  legacy: number;
  firstInvalidSeq: number | null;
}

export async function verifyChain(db: Db): Promise<ChainVerification> {
  const rows = await db.select().from(auditLog).orderBy(asc(auditLog.seq));
  let prevHash = GENESIS;
  let checked = 0;
  let legacy = 0;
  for (const row of rows) {
    if (!row.entryHash) {
      legacy++;
      continue;
    }
    const expected = canonicalHash(prevHash, {
      id: row.id,
      userId: row.userId,
      apiKeyId: row.apiKeyId,
      action: row.action,
      resource: row.resource,
      detail: row.detail,
      ip: row.ip,
      createdAt: row.createdAt,
    });
    if (expected !== row.entryHash || row.prevHash !== prevHash) {
      return { ok: false, checked, legacy, firstInvalidSeq: row.seq };
    }
    prevHash = row.entryHash;
    checked++;
  }
  return { ok: true, checked, legacy, firstInvalidSeq: null };
}
