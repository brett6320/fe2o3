import { describe, expect, it } from 'vitest';
import edgeos from '../src/core/models/edgeos.js';
import eos from '../src/core/models/eos.js';
import ios from '../src/core/models/ios.js';
import junos from '../src/core/models/junos.js';
import routeros from '../src/core/models/routeros.js';

function scrub(driver: { scrubbers: ((t: string) => string)[] }, text: string) {
  let out = text;
  for (const s of driver.scrubbers) out = s(out);
  return out;
}

describe('driver scrubbers', () => {
  it('junos hides secrets and volatile headers', () => {
    const out = scrub(
      junos,
      [
        '## Last commit: 2026-07-24 01:02:03 UTC by admin',
        'system {',
        '  root-authentication {',
        '    encrypted-password "$6$abcdef$hash"; ## SECRET-DATA',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(out).not.toContain('Last commit');
    expect(out).not.toContain('$6$abcdef$hash');
    expect(out).toContain('<secret hidden>');
  });

  it('eos hides enable secret and community', () => {
    const out = scrub(
      eos,
      [
        '! Command: show running-config',
        'enable secret sha512 $6$hash',
        'snmp-server community private ro',
      ].join('\n'),
    );
    expect(out).not.toContain('$6$hash');
    expect(out).not.toContain('private');
    expect(out).not.toContain('Command: show running-config');
  });

  it('ios drops the volatile show-version uptime line', () => {
    const out = scrub(
      ios,
      [
        'cisco WS-C3560-48PS (PowerPC405) processor',
        'core-sw1 uptime is 20 weeks, 4 days, 1 hour, 43 minutes',
        'Uptime for this control processor is 20 weeks, 4 days',
        'System returned to ROM by power-on',
        'hostname core-sw1',
      ].join('\n'),
    );
    expect(out).not.toContain('uptime is');
    expect(out).not.toContain('Uptime for');
    // stable lines survive
    expect(out).toContain('System returned to ROM by power-on');
    expect(out).toContain('hostname core-sw1');
  });

  it('routeros normalizes the volatile export header (keeps version, drops timestamp)', () => {
    const out = scrub(
      routeros,
      [
        '# jul/24/2026 01:02:03 by RouterOS 7.15',
        '# software id = ABCD-EFGH',
        '/interface bridge',
        'add name=br0',
      ].join('\n'),
    );
    expect(out).not.toContain('jul/24/2026');
    expect(out).toContain('# by RouterOS 7.15');
    expect(out).not.toContain('software id');
    expect(out).toContain('add name=br0');
  });

  it('edgeos hides passwords', () => {
    const out = scrub(
      edgeos,
      ["set system login user admin authentication encrypted-password '$5$secret$hash'"].join('\n'),
    );
    expect(out).not.toContain('$5$secret$hash');
  });

  it('ios prompt matches typical prompts', () => {
    for (const p of ['router1#', 'sw-core.lab>', 'r1(config)#']) {
      expect(ios.prompt.test(`${p} `)).toBe(true);
    }
  });
});
