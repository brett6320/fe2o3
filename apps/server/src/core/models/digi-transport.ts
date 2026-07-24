import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';

/**
 * Digi TransPort (Sarian OS) cellular routers — WR/DR/SR series with the
 * `ss<serial>>` CLI. Distinct from Digi Accelerated Linux (`digi_dal`).
 *
 * `config c show` dumps the running configuration as `<section> <n> <param>
 * <value>` lines, terminated by `OK`. The CLI is AT-command based, so commands
 * are submitted with a carriage return. TransPort SSH is old; telnet is often
 * more reliable — set the device protocol accordingly.
 */
export default defineDriver({
  id: 'digi_transport',
  displayName: 'Digi TransPort (Sarian)',
  // unit id format is `ss<serial>>` (see `cmd 0 unitid "ss%s>"`)
  prompt: /^\S+>\s?$/m,
  errorPatterns: [/Command not recogni[sz]ed/i],
  comment: '# ',
  // AT-command heritage: commands submit on carriage return, not line feed.
  lineEnding: '\r',
  // Sarian doesn't reprint the prompt after a command over SSH; every command
  // ends with a bare `OK`.
  commandComplete: /^OK\s*$/m,
  init: [],
  commands: [
    { cmd: 'ati', name: 'identity', optional: true },
    // `c` = current/running config; `0` = saved persistent profile
    { cmd: 'config c show', name: 'running-config' },
    { cmd: 'config 0 show', name: 'saved-config', optional: true },
  ],
  scrubbers: [
    // encrypted password fields: `user N epassword "…"`, `enewpwd`, `epwd`
    hideSecret(/\b(?:epassword|enewpwd|epwd|epasswd|password)\s+"?([^"\s]+)"?/gim),
    // provisioning strings and pre-shared keys
    hideSecret(/\bprovision\s+\d+\s+string\d+\s+"?([^"\s]+)"?/gim),
    hideSecret(/\b(?:preshared|psk|secret|keyphrase)\s+"?([^"\s]+)"?/gim),
    // drop the trailing `OK` command terminator so it isn't stored as config
    dropLines(/^OK\s*$/),
  ],
});
