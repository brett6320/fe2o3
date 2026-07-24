import { defineDriver, dropLines } from '@fe2o3/driver-sdk';

/**
 * MikroTik RouterOS. `/export` prints the full config; the leading timestamp
 * header changes every run and is dropped (ported from oxidized routeros.rb).
 */
export default defineDriver({
  id: 'routeros',
  displayName: 'MikroTik RouterOS',
  // e.g. `[admin@MikroTik] >` (with possible ANSI garbage already stripped)
  prompt: /\[[^\]\n]+\]\s?>\s?$/m,
  errorPatterns: [/^bad command name/m, /^syntax error/m],
  comment: '# ',
  init: [],
  commands: [{ cmd: '/export', name: 'export' }],
  scrubbers: [
    // volatile header: "# jan/02/2026 03:04:05 by RouterOS 7.x"
    dropLines(/^# \w{3}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} by RouterOS /),
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
});
