import {
  type DeviceFacts,
  defineDriver,
  dropLines,
  hideSecret,
  type InventoryItem,
} from '@fe2o3/driver-sdk';
import { section } from './sections.js';
import { parseJunosUptime } from './uptime.js';

const COMMENT = '# ';

const HW_HEADER = /^Item\s+Version\s+Part number\s+Serial number\s+Description/;
// Lines that appear inside the section but aren't inventory rows: the dashed
// separators, the "Hardware inventory:" heading, a repeated column header, node
// markers, and the trailing `{primary:node0}` cluster status line.
const HW_NOISE = /^(?:-{3,}\s*$|Hardware inventory:|node\d+:|\{.*\}\s*$)/;

/**
 * Parse one `show chassis hardware` table — a fixed-width table whose columns
 * are located from the header row, with 2-space indentation encoding the
 * component tree (Chassis → FPC → PIC → Xcvr).
 */
function parseTable(block: string): { serial: string | undefined; items: InventoryItem[] } {
  const lines = block.split('\n');
  const headerIdx = lines.findIndex((l) => HW_HEADER.test(l));
  if (headerIdx === -1) return { serial: undefined, items: [] };
  const header = lines[headerIdx] ?? '';
  const col = {
    version: header.indexOf('Version'),
    part: header.indexOf('Part number'),
    serial: header.indexOf('Serial number'),
    desc: header.indexOf('Description'),
  };

  const items: InventoryItem[] = [];
  const stack: { depth: number; item: InventoryItem }[] = [];
  let chassisSerial: string | undefined;

  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim() || HW_NOISE.test(line) || HW_HEADER.test(line)) continue;
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
      items.push(item);
    }
    stack.push({ depth, item });

    if (name === 'Chassis' && serial) chassisSerial = serial;
  }
  return { serial: chassisSerial ?? items[0]?.serial, items };
}

/**
 * Parse `show chassis hardware`. On a chassis cluster the output repeats per
 * node (`node0:` / `node1:`); each node's inventory is grouped under a node
 * item and every chassis serial is surfaced. A standalone device is a single
 * table.
 */
function parseHardware(text: string): { serial: string | undefined; inventory: InventoryItem[] } {
  if (!/^node\d+:\s*$/m.test(text)) {
    const { serial, items } = parseTable(text);
    return { serial, inventory: items };
  }

  const blocks: { node: string; lines: string[] }[] = [];
  let cur: { node: string; lines: string[] } | null = null;
  for (const line of text.split('\n')) {
    const m = /^(node\d+):\s*$/.exec(line);
    if (m) {
      cur = { node: m[1] ?? 'node', lines: [] };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }

  const inventory: InventoryItem[] = [];
  const serials: string[] = [];
  for (const b of blocks) {
    const { serial, items } = parseTable(b.lines.join('\n'));
    if (serial) serials.push(serial);
    const parent: InventoryItem = { name: b.node };
    if (items.length) parent.children = items;
    inventory.push(parent);
  }
  return { serial: serials.length ? serials.join(', ') : undefined, inventory };
}

/** Parse model, Junos version, serial, and hardware inventory from a JunOS config. */
function junosFacts(config: string): DeviceFacts | null {
  const version = section(config, 'version', COMMENT);
  const model = /^Model:\s*(\S+)/im.exec(version)?.[1];
  // Prefer the explicit `Junos:` line; otherwise take the bracketed version
  // from any `JUNOS <component> [x]` line (EX/older releases report it only
  // there, with no `Junos:` or `JUNOS Software Release` line).
  const osVersion =
    /^Junos:\s*(\S+)/im.exec(version)?.[1] ?? /JUNOS\b.*?\[([^\]]+)\]/i.exec(version)?.[1];
  const { serial, inventory } = parseHardware(section(config, 'hardware', COMMENT));

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
  uptime: { cmd: 'show system uptime', parse: parseJunosUptime },
});
