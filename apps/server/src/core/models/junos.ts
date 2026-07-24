import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';

/** Juniper JunOS. Scrubbers ported from oxidized's junos.rb model. */
export default defineDriver({
  id: 'junos',
  displayName: 'Juniper JunOS',
  prompt: /^[\w.-]+@[\w.-]+[%>#]\s?$/m,
  errorPatterns: [/^(?:syntax error|unknown command)/m],
  comment: '# ',
  init: [{ cmd: 'set cli screen-length 0' }, { cmd: 'set cli screen-width 0' }],
  commands: [
    { cmd: 'show version', name: 'version' },
    { cmd: 'show chassis hardware', name: 'hardware' },
    { cmd: 'show configuration', name: 'configuration' },
  ],
  scrubbers: [
    dropLines(/^## Last commit: /),
    dropLines(/^## Last changed: /),
    dropLines(/^Hostname: /),
    hideSecret(/encrypted-password "?([^";\s]+)"?/gm),
    hideSecret(/authentication-key "?([^";\s]+)"?/gm),
    hideSecret(/(?:pre-shared-key|ascii-text|hexadecimal) "?([^";\s]+)"?/gm),
    hideSecret(/community "?([^";\s]+)"? {/gm),
    hideSecret(/secret "?([^";\s]+)"?/gm),
  ],
});
