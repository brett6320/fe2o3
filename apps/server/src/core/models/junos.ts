import {
  type DeviceFacts,
  defineDriver,
  dropLines,
  hideSecret,
  type InventoryItem,
} from '@fe2o3/driver-sdk';

/** Extract a named `# --- <name> ---` section body from an assembled config. */
function section(config: string, name: string): string {
  const header = new RegExp(`^# --- ${name} ---$`, 'm');
  const m = header.exec(config);
  if (!m) return '';
  const rest = config.slice(m.index + m[0].length);
  const next = rest.search(/^# --- .+ ---$/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/**
 * Parse `show chassis hardware` — a fixed-width table whose columns are located
 * from the header row, with 2-space indentation encoding the component tree
 * (Chassis → FPC → PIC …). Returns the chassis serial and the inventory tree.
 */
function parseHardware(text: string): { serial: string | undefined; inventory: InventoryItem[] } {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) =>
    /^Item\s+Version\s+Part number\s+Serial number\s+Description/.test(l),
  );
  if (headerIdx === -1) return { serial: undefined, inventory: [] };
  const header = lines[headerIdx] ?? '';
  const col = {
    version: header.indexOf('Version'),
    part: header.indexOf('Part number'),
    serial: header.indexOf('Serial number'),
    desc: header.indexOf('Description'),
  };

  const inventory: InventoryItem[] = [];
  const stack: { depth: number; item: InventoryItem }[] = [];
  let chassisSerial: string | undefined;

  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const itemRaw = line.slice(0, col.version);
    const name = itemRaw.trim();
    if (!name) continue;
    const depth = (itemRaw.match(/^ */)?.[0].length ?? 0) >> 1; // 2 spaces per level
    const pid = line.slice(col.part, col.serial).trim();
    const serial = line.slice(col.serial, col.desc).trim();
    const description = line.slice(col.desc).trim();

    const item: InventoryItem = { name };
    if (description) item.description = description;
    if (pid) item.pid = pid;
    if (serial) item.serial = serial;

    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? -1) >= depth) stack.pop();
    const parent = stack[stack.length - 1]?.item;
    if (parent) {
      parent.children ??= [];
      parent.children.push(item);
    } else {
      inventory.push(item);
    }
    stack.push({ depth, item });

    if (name === 'Chassis' && serial) chassisSerial = serial;
  }
  return { serial: chassisSerial ?? inventory[0]?.serial, inventory };
}

/** Parse model, Junos version, serial, and hardware inventory from a JunOS config. */
function junosFacts(config: string): DeviceFacts | null {
  const version = section(config, 'version');
  const model = /^Model:\s*(\S+)/im.exec(version)?.[1];
  const osVersion =
    /^Junos:\s*(\S+)/im.exec(version)?.[1] ??
    /JUNOS Software Release \[([^\]]+)\]/i.exec(version)?.[1];
  const { serial, inventory } = parseHardware(section(config, 'hardware'));

  const facts: DeviceFacts = {};
  if (serial) facts.serial = serial;
  if (model) facts.model = model;
  if (osVersion) facts.osVersion = osVersion;
  if (inventory.length) facts.inventory = inventory;
  return Object.keys(facts).length ? facts : null;
}

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
  facts: junosFacts,
});
