import { describe, expect, it } from 'vitest';
import routeros from '../src/core/models/routeros.js';

const scrub = (text: string) => routeros.scrubbers.reduce((acc, s) => s(acc), text);

const exportHeader = `# --- export ---
# 2026-07-24 23:17:43 by RouterOS 7.15.1
#
# model = RBwAPR-2nD
# serial number = DA4A0C66E067
#
/interface bridge
add name=bridge1
`;

describe('routeros facts parser', () => {
  it('parses model, serial and version from the /export header', () => {
    const f = routeros.facts?.(exportHeader);
    expect(f).not.toBeNull();
    expect(f?.model).toBe('RBwAPR-2nD');
    expect(f?.serial).toBe('DA4A0C66E067');
    expect(f?.osVersion).toBe('7.15.1');
  });

  it('still parses version after the header timestamp is scrubbed', () => {
    const f = routeros.facts?.(scrub(exportHeader));
    expect(f?.osVersion).toBe('7.15.1');
    expect(f?.model).toBe('RBwAPR-2nD');
  });
});

describe('routeros header scrubber', () => {
  it('drops the per-run timestamp but keeps the RouterOS version (ISO format)', () => {
    const out = scrub(exportHeader);
    expect(out).toContain('# by RouterOS 7.15.1');
    expect(out).not.toContain('2026-07-24 23:17:43');
    // re-exporting at a different time produces an identical scrubbed header
    const later = exportHeader.replace('2026-07-24 23:17:43', '2026-08-01 06:00:00');
    expect(scrub(later)).toBe(out);
  });

  it('also normalizes the legacy date format', () => {
    const legacy = '# jan/02/2026 03:04:05 by RouterOS 6.49\n# model = X\n';
    expect(scrub(legacy)).toContain('# by RouterOS 6.49');
    expect(scrub(legacy)).not.toContain('jan/02/2026');
  });
});
