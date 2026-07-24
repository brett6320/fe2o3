import { decryptSecret, encryptSecret } from '../auth/crypto.js';

/**
 * Per-device `vars` that hold secrets. Plaintext arrives from the API as
 * `<key>`, is stored encrypted as `<key>Enc`, and is surfaced back to clients
 * only as `<key>Set: true` — same write-only contract as credentials.
 */
const SECRET_VARS = ['enablePassword'] as const;

type Vars = Record<string, unknown>;

/**
 * Prepare incoming vars for storage: encrypt secret vars, and when a secret is
 * omitted entirely, carry over the existing encrypted value (write-only PATCH
 * semantics — clients never see the ciphertext to send it back).
 * An empty string clears the secret.
 */
export function sealDeviceVars(incoming: Vars, existing: Vars | undefined, key: Buffer): Vars {
  const out: Vars = { ...incoming };
  for (const name of SECRET_VARS) {
    const encKey = `${name}Enc`;
    delete out[`${name}Set`];
    const value = out[name];
    if (typeof value === 'string') {
      delete out[name];
      if (value !== '') out[encKey] = encryptSecret(value, key);
      // '' ⇒ cleared: neither plaintext nor Enc kept
    } else if (existing && typeof existing[encKey] === 'string') {
      out[encKey] = existing[encKey];
    }
  }
  return out;
}

/** Strip ciphertext from vars before returning them via the API. */
export function publicDeviceVars(vars: Vars): Vars {
  const out: Vars = { ...vars };
  for (const name of SECRET_VARS) {
    const encKey = `${name}Enc`;
    if (typeof out[encKey] === 'string') {
      delete out[encKey];
      out[`${name}Set`] = true;
    }
  }
  return out;
}

/** Decrypt one secret var for use by the backup engine. */
export function deviceVarSecret(
  vars: Vars,
  name: (typeof SECRET_VARS)[number],
  key: Buffer,
): string | undefined {
  const enc = vars[`${name}Enc`];
  return typeof enc === 'string' ? decryptSecret(enc, key) : undefined;
}
