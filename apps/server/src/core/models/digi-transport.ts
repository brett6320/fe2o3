import {
  type DeviceFacts,
  defineDriver,
  dropLines,
  hideSecret,
  type InventoryItem,
} from '@fe2o3/driver-sdk';
import { parseVerboseDuration } from './uptime.js';

/** Parse serial/model/part from the Sarian `hw` command output. */
function digiTransportFacts(config: string): DeviceFacts | null {
  const serial = /^Serial Number:\s*(\S+)/im.exec(config)?.[1];
  const model = /^Model:\s*(\S+)/im.exec(config)?.[1];
  const part = /^Part#:\s*(\S+)/im.exec(config)?.[1];
  const rev = /^HW Rev:\s*(\S+)/im.exec(config)?.[1];

  const facts: DeviceFacts = {};
  if (serial) facts.serial = serial;
  if (model) facts.model = model;
  if (serial || model || part) {
    const item: InventoryItem = { name: model ?? 'Chassis' };
    if (part) item.pid = part;
    if (serial) item.serial = serial;
    if (rev) item.description = `HW Rev ${rev}`;
    facts.inventory = [item];
  }
  return Object.keys(facts).length ? facts : null;
}

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
    // `hw` prints serial / model / part# / HW rev / MACs (stable — safe to store)
    { cmd: 'hw', name: 'hardware', optional: true },
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
  facts: digiTransportFacts,
  // `uptime` → "Uptime 96 Hrs 0 Mins 12 Seconds\nOK" (stat command, not committed)
  uptime: { cmd: 'uptime', parse: parseVerboseDuration },
});
