import {
  type DeviceFacts,
  defineDriver,
  dropLines,
  hideSecret,
  type InventoryItem,
} from '@fe2o3/driver-sdk';

/** Extract a named `! --- <name> ---` section body from an assembled config. */
function section(config: string, name: string): string {
  const header = new RegExp(`^! --- ${name} ---$`, 'm');
  const m = header.exec(config);
  if (!m) return '';
  const rest = config.slice(m.index + m[0].length);
  const next = rest.search(/^! --- .+ ---$/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Parse Cisco `show inventory` NAME/DESCR + PID/VID/SN pairs into a flat list. */
function parseInventory(text: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const nd = /NAME:\s*"([^"]*)",\s*DESCR:\s*"([^"]*)"/.exec(lines[i] ?? '');
    if (!nd) continue;
    const pidLine = lines[i + 1] ?? '';
    const pid = /PID:\s*(\S.*?)\s*,/.exec(pidLine)?.[1]?.trim();
    const serial = /SN:\s*(\S+)/.exec(pidLine)?.[1]?.trim();
    items.push({
      name: nd[1] ?? '',
      description: nd[2] || undefined,
      pid: pid || undefined,
      serial: serial || undefined,
    });
  }
  return items;
}

/** Parse serial, model, IOS version and inventory from a stored IOS config. */
function iosFacts(config: string): DeviceFacts | null {
  const version = section(config, 'version');
  const inventory = parseInventory(section(config, 'inventory'));

  const osVersion = /\bVersion\s+([^\s,]+)/.exec(version)?.[1];
  const model =
    /^Model number\s*:\s*(\S+)/im.exec(version)?.[1] ??
    /^cisco\s+(\S+).*\bprocessor\b/im.exec(version)?.[1] ??
    inventory[0]?.pid;
  const serial =
    /^System serial number\s*:\s*(\S+)/im.exec(version)?.[1] ??
    /^Processor board ID\s+(\S+)/im.exec(version)?.[1] ??
    inventory[0]?.serial;

  const facts: DeviceFacts = {};
  if (serial) facts.serial = serial;
  if (model) facts.model = model;
  if (osVersion) facts.osVersion = osVersion;
  if (inventory.length) facts.inventory = inventory;
  return Object.keys(facts).length ? facts : null;
}

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
    { cmd: 'show inventory', name: 'inventory', optional: true },
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
    // `show version` uptime advances every poll; drop it so it doesn't look
    // like a config change ("<host> uptime is …", "Uptime for … is …").
    dropLines(/\buptime (?:is|for) /i),
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
  facts: iosFacts,
});
