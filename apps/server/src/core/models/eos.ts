import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';
import { parseVerboseDuration } from './uptime.js';

/** Arista EOS. Scrubbers ported from oxidized's eos.rb model. */
export default defineDriver({
  id: 'eos',
  displayName: 'Arista EOS',
  prompt: /^[\w.@()/:-]+[#>]\s?$/m,
  errorPatterns: [/^% (?:Invalid|Incomplete|Ambiguous)/m],
  comment: '! ',
  init: [{ cmd: 'terminal length 0' }, { cmd: 'terminal width 32767' }],
  enable: { cmd: 'enable', passPrompt: /Password:\s?$/i },
  commands: [
    { cmd: 'show version', name: 'version' },
    { cmd: 'show inventory', name: 'inventory', optional: true },
    { cmd: 'show running-config', name: 'running-config' },
  ],
  scrubbers: [
    dropLines(/^! Command: show running-config/),
    dropLines(/^! device: /),
    dropLines(/^! boot system flash.*$/),
    // `show version` uptime advances every poll — keep it out of the config
    dropLines(/^Uptime: /),
    hideSecret(/^enable (?:secret|password) (?:\d |sha512 )?(\S+)/gm),
    hideSecret(/^username \S+ .*(?:secret|password) (?:\d |sha512 )?(\S+)/gm),
    hideSecret(/^snmp-server community (\S+)/gm),
    hideSecret(/(?:password|secret) (?:\d |7 |sha512 )?(\S+)$/gm),
  ],
  uptime: {
    // from the already-collected `show version` "Uptime: …" line
    parse: (text) => {
      const m = /^Uptime:\s*(.+)/im.exec(text);
      return m?.[1] ? parseVerboseDuration(m[1]) : null;
    },
  },
});
