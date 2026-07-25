import { type DeviceFacts, defineDriver, hideSecret, type InventoryItem } from '@fe2o3/driver-sdk';
import { section } from './sections.js';
import { parseSeconds } from './uptime.js';

const COMMENT = '# ';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/** Parse model + serial from the Cradlepoint `product-info` JSON section. */
function cradlepointFacts(config: string): DeviceFacts | null {
  const raw = section(config, 'product-info', COMMENT);
  if (!raw) return null;
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const mfg = (info.manufacturing ?? {}) as Record<string, unknown>;
  const serial = str(mfg.serial_num);
  const model = str(info.product_name);

  const facts: DeviceFacts = {};
  if (serial) facts.serial = serial;
  if (model) facts.model = model;
  if (serial || model) {
    const detail = [
      str(mfg.board_ID) && `board ${str(mfg.board_ID)}`,
      str(info.mac0) && `MAC ${str(info.mac0)}`,
    ]
      .filter(Boolean)
      .join(', ');
    const item: InventoryItem = { name: model ?? 'Chassis' };
    if (model) item.pid = model;
    if (serial) item.serial = serial;
    if (detail) item.description = detail;
    facts.inventory = [item];
  }
  return Object.keys(facts).length ? facts : null;
}

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
  facts: cradlepointFacts,
  uptime: { cmd: 'get status/system/uptime', parse: parseSeconds },
});
