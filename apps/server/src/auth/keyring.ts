import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Versioned symmetric keyring for secrets at rest.
 *
 * Encrypted blobs carry the id of the key that sealed them (`v2:<id>:<payload>`);
 * new encryptions always use the active key, so rotation is: add a key, make it
 * active, re-encrypt stored blobs, then optionally drop the old key.
 * Legacy blobs without a version prefix are tried against every key.
 */
export interface Keyring {
  activeId: string;
  keys: Map<string, Buffer>;
}

interface KeyringFile {
  active: string;
  keys: Record<string, string>; // id → 64-char hex
}

const FILE = 'keys.json';

function parseHex(id: string, hex: string): Buffer {
  const key = Buffer.from(hex.trim(), 'hex');
  if (key.length !== 32) throw new Error(`keyring: key ${id} must be 64 hex chars (32 bytes)`);
  return key;
}

/**
 * Load `<dataDir>/keys.json`, migrating from the single-key world
 * (`FE2O3_SECRET_KEY` env or `<dataDir>/secret.key`) as key id "1".
 */
export function loadKeyring(dataDir: string, envSecretHex?: string): Keyring {
  const path = join(dataDir, FILE);
  if (existsSync(path)) {
    const file = JSON.parse(readFileSync(path, 'utf8')) as KeyringFile;
    const keys = new Map(Object.entries(file.keys).map(([id, hex]) => [id, parseHex(id, hex)]));
    if (!keys.has(file.active)) throw new Error(`keyring: active key ${file.active} not present`);
    return { activeId: file.active, keys };
  }

  let hex = envSecretHex;
  if (!hex) {
    const legacyFile = join(dataDir, 'secret.key');
    hex = existsSync(legacyFile)
      ? readFileSync(legacyFile, 'utf8').trim()
      : randomBytes(32).toString('hex');
  }
  const keyring: Keyring = { activeId: '1', keys: new Map([['1', parseHex('1', hex)]]) };
  saveKeyring(dataDir, keyring);
  return keyring;
}

export function saveKeyring(dataDir: string, keyring: Keyring): void {
  const file: KeyringFile = {
    active: keyring.activeId,
    keys: Object.fromEntries([...keyring.keys].map(([id, key]) => [id, key.toString('hex')])),
  };
  const path = join(dataDir, FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Generate a fresh key, persist it as active, and return its id. */
export function addActiveKey(dataDir: string, keyring: Keyring): string {
  const nextId = String(
    Math.max(0, ...[...keyring.keys.keys()].map(Number).filter(Number.isFinite)) + 1,
  );
  keyring.keys.set(nextId, randomBytes(32));
  keyring.activeId = nextId;
  saveKeyring(dataDir, keyring);
  return nextId;
}

/** Remove a retired key. Refuses to drop the active key. */
export function removeKey(dataDir: string, keyring: Keyring, id: string): boolean {
  if (id === keyring.activeId) throw new Error('cannot remove the active key');
  const removed = keyring.keys.delete(id);
  if (removed) saveKeyring(dataDir, keyring);
  return removed;
}
