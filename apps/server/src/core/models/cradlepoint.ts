import { defineDriver, hideSecret } from '@fe2o3/driver-sdk';

/**
 * Cradlepoint NCOS (NetCloud OS) cellular routers.
 *
 * NOTE: authored against the documented NCOS CLI — verify against your unit.
 * The NCOS CLI exposes a config tree via `get`; `get config` dumps the whole
 * running configuration (JSON-ish). If your prompt or command differs, adjust
 * `prompt` / `commands` (or drop a plugin driver override in the data dir).
 */
export default defineDriver({
  id: 'cradlepoint',
  displayName: 'Cradlepoint NCOS',
  // e.g. `[admin@IBR900-abc: /]$ ` — a bracketed path prompt ending in $ or #
  prompt: /\][$#]\s?$/m,
  errorPatterns: [/^(?:Error|Invalid|Unknown command)/im],
  comment: '# ',
  init: [],
  commands: [
    { cmd: 'get status/product_info', name: 'product-info' },
    { cmd: 'get config', name: 'config' },
  ],
  scrubbers: [
    // NCOS config is JSON-ish: "password": "…" — hide the common secret keys
    hideSecret(
      /"(?:password|passphrase|psk|wpa_psk|secret|shared_secret|api_key|token)"\s*:\s*"([^"]*)"/gim,
    ),
  ],
});
