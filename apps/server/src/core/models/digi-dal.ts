import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';
import { parseVerboseDuration } from './uptime.js';

/**
 * Digi Accelerated Linux (DAL) cellular routers — WR/EX/IX/6300 series.
 *
 * NOTE: authored against the documented DAL CLI — verify against your unit.
 * DAL provides `show config` (running configuration) and `show system`. Older
 * Digi TransPort (WR/DR) devices use a different CLI; this driver targets DAL.
 * Adjust `prompt` / `commands` if your firmware differs.
 */
export default defineDriver({
  id: 'digi_dal',
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
  uptime: {
    // from the already-collected `show system`:
    // "Uptime : 6 days, 6 hours, 21 minutes, 57 seconds (541317s)"
    parse: (text) => {
      const secs = /^\s*uptime\s*:?.*?\((\d+)\s*s\)/im.exec(text);
      if (secs?.[1]) return Number(secs[1]);
      const human = /^\s*uptime\s*:?\s*(.+)/im.exec(text);
      return human?.[1] ? parseVerboseDuration(human[1]) : null;
    },
  },
});
