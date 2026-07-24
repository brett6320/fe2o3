import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';

/** Cisco IOS / IOS-XE. Scrubbers ported from oxidized's ios.rb model. */
export default defineDriver({
  id: 'ios',
  displayName: 'Cisco IOS / IOS-XE',
  prompt: /^[\w.@()/:-]+[#>]\s?$/m,
  errorPatterns: [/^% (?:Invalid|Incomplete|Ambiguous)/m],
  comment: '! ',
  init: [{ cmd: 'terminal length 0' }, { cmd: 'terminal width 0' }],
  enable: { cmd: 'enable', passPrompt: /Password:\s?$/i },
  commands: [
    { cmd: 'show version', name: 'version' },
    { cmd: 'show inventory', name: 'inventory' },
    { cmd: 'show running-config', name: 'running-config' },
  ],
  scrubbers: [
    // volatile lines that would create noisy diffs
    dropLines(/^ntp clock-period /),
    dropLines(/^! Last configuration change at /),
    dropLines(/^! NVRAM config last updated at /),
    dropLines(/^Building configuration\.\.\./),
    dropLines(/^Current configuration : \d+ bytes/),
    dropLines(/^Load for five secs/),
    dropLines(/^Time source is /),
    // secrets
    hideSecret(/^enable (?:secret|password)(?: level \d+)? (?:\d )?(\S+)/gm),
    hideSecret(/^username (\S+) privilege (\d+) (?:secret|password) (?:\d )?(\S+)/gm),
    hideSecret(/^username \S+ (?:secret|password) (?:\d )?(\S+)/gm),
    hideSecret(/(?:password|secret) (?:\d )?(\S+)$/gm),
    hideSecret(/^tacacs-server (?:host \S+ )?key (?:\d )?(\S+)/gm),
    hideSecret(/^snmp-server community (\S+)/gm),
    hideSecret(/^snmp-server host (?:\S+) (?:informs? |traps? |version (?:1|2c|3) )*(\S+)/gm),
    hideSecret(/^crypto isakmp key (\S+) address/gm),
    hideSecret(/^(?:\s+)?ip ospf message-digest-key \d+ md5 (?:\d )?(\S+)/gm),
    hideSecret(/^(?:\s+)?standby \d+ authentication (?:md5 key-string )?(\S+)/gm),
    hideSecret(/wpa-psk (?:ascii|hex) (?:\d )?(\S+)/gm),
  ],
  vars: [
    {
      key: 'enablePassword',
      description: 'Use enable mode with this password (falls back to credential enable password)',
      type: 'string',
    },
  ],
});
