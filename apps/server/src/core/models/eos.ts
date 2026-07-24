import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';

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
    hideSecret(/^enable (?:secret|password) (?:\d |sha512 )?(\S+)/gm),
    hideSecret(/^username \S+ .*(?:secret|password) (?:\d |sha512 )?(\S+)/gm),
    hideSecret(/^snmp-server community (\S+)/gm),
    hideSecret(/(?:password|secret) (?:\d |7 |sha512 )?(\S+)$/gm),
  ],
});
