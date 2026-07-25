import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';
import { parseBsdUptime } from './uptime.js';

/** Ubiquiti EdgeOS (EdgeRouter). Ported from oxidized's edgeos.rb model. */
export default defineDriver({
  id: 'edgeos',
  displayName: 'Ubiquiti EdgeOS',
  prompt: /[$#]\s?$/m,
  comment: '# ',
  init: [{ cmd: 'terminal length 0' }],
  commands: [
    { cmd: 'show version', name: 'version' },
    { cmd: 'show configuration commands', name: 'configuration' },
  ],
  scrubbers: [
    hideSecret(/encrypted-password '?([^'\s]+)'?/gm),
    hideSecret(/plaintext-password '?([^'\s]+)'?/gm),
    hideSecret(/password '?([^'\s]+)'?/gm),
    hideSecret(/pre-shared-secret '?([^'\s]+)'?/gm),
    hideSecret(/community '?([^'\s]+)'?/gm),
    dropLines(/^Booted: /),
    dropLines(/^Uptime: /),
  ],
  uptime: {
    // from the pre-scrub `show version` "Uptime: … up …" line
    parse: (text) => {
      const m = /^Uptime:\s*(.+)/im.exec(text);
      return m?.[1] ? parseBsdUptime(m[1]) : null;
    },
  },
});
