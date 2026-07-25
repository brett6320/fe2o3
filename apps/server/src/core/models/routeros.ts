import { type DeviceFacts, defineDriver, dropLines } from '@fe2o3/driver-sdk';

/** Parse model, serial and version from the `/export` header comments. */
function routerosFacts(config: string): DeviceFacts | null {
  const model = /^#\s*model\s*=\s*(\S+)/im.exec(config)?.[1];
  const serial = /^#\s*serial number\s*=\s*(\S+)/im.exec(config)?.[1];
  const osVersion = /\bby RouterOS\s+(\S+)/i.exec(config)?.[1];

  const facts: DeviceFacts = {};
  if (serial) facts.serial = serial;
  if (model) facts.model = model;
  if (osVersion) facts.osVersion = osVersion;
  return Object.keys(facts).length ? facts : null;
}

/**
 * MikroTik RouterOS. `/export` prints the full config; the leading timestamp
 * header changes every run and is normalized (ported from oxidized routeros.rb).
 */
export default defineDriver({
  id: 'routeros',
  displayName: 'MikroTik RouterOS',
  // e.g. `[admin@MikroTik] >` (with possible ANSI garbage already stripped)
  prompt: /\[[^\]\n]+\]\s?>\s?$/m,
  errorPatterns: [/^bad command name/m, /^syntax error/m],
  comment: '# ',
  init: [],
  // RouterOS submits commands on carriage return, not line feed.
  lineEnding: '\r',
  commands: [{ cmd: '/export', name: 'export' }],
  scrubbers: [
    // Normalize the volatile export header — keep the RouterOS version but drop
    // the per-run timestamp so re-exports don't diff. Covers ISO
    // (`2026-07-24 23:17:43`, RouterOS 7.x) and legacy (`jan/02/2026 03:04:05`).
    (text) =>
      text.replace(
        /^# (?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\w{3}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}) (by RouterOS \S+)/m,
        '# $1',
      ),
    dropLines(/^# software id = /),
  ],
  vars: [
    {
      key: 'loginSuffix',
      description: 'Appended to username to disable colors/paging (default "+ct200w")',
      type: 'string',
      default: '+ct200w',
    },
  ],
  facts: routerosFacts,
});
