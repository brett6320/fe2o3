import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

import type { Keyring } from './keyring.js';

function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function open(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * AES-256-GCM with the keyring's active key. Blob format `v2:<keyId>:<base64(iv‖tag‖ct)>`
 * so rotation can decrypt with the exact key that sealed each value.
 * For secrets that must be recoverable (device credentials, TOTP secrets).
 */
export function encryptSecret(plaintext: string, keyring: Keyring): string {
  const key = keyring.keys.get(keyring.activeId);
  if (!key) throw new Error(`keyring: active key ${keyring.activeId} missing`);
  return `v2:${keyring.activeId}:${seal(plaintext, key)}`;
}

/** Id of the key a blob was sealed with; null for legacy prefix-less blobs. */
export function blobKeyId(payload: string): string | null {
  const m = /^v2:([^:]+):/.exec(payload);
  return m?.[1] ?? null;
}

export function decryptSecret(payload: string, keyring: Keyring): string {
  const m = /^v2:([^:]+):(.+)$/.exec(payload);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    const key = keyring.keys.get(m[1]);
    if (!key) throw new Error(`keyring: no key with id ${m[1]}`);
    return open(m[2], key);
  }
  // Legacy blob from the single-key era: GCM auth tags make trying keys safe.
  let lastErr: unknown;
  for (const key of keyring.keys.values()) {
    try {
      return open(payload, key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`keyring: no key decrypts legacy blob (${String(lastErr)})`);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Opaque bearer/session tokens: random value returned to client, sha256 stored. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
