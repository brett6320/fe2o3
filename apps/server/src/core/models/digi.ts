import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';

/**
 * Digi Accelerated Linux (DAL) cellular routers — WR/EX/IX/6300 series.
 *
 * NOTE: authored against the documented DAL CLI — verify against your unit.
 * DAL provides `show config` (running configuration) and `show system`. Older
 * Digi TransPort (WR/DR) devices use a different CLI; this driver targets DAL.
 * Adjust `prompt` / `commands` if your firmware differs.
 */
export default defineDriver({
  id: 'digi',
  displayName: 'Digi Accelerated Linux (DAL)',
  // e.g. `admin@hostname>` or `hostname#`
  prompt: /[>#]\s?$/m,
  errorPatterns: [/^(?:Error|Invalid|Unrecognized|Unknown)/im],
  comment: '# ',
  init: [],
  commands: [
    { cmd: 'show system', name: 'system' },
    { cmd: 'show config', name: 'config' },
  ],
  scrubbers: [
    dropLines(/^\s*uptime\s+/i),
    // DAL config lines: `... password <secret>`, `... key <secret>`, PSKs
    hideSecret(/\b(?:password|passphrase|pre_shared_key|psk|secret|key)\s+(\S+)/gim),
  ],
});
