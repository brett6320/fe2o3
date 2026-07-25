import { describe, expect, it } from 'vitest';
import { section } from '../src/core/models/sections.js';

const iosCfg = `! --- version ---
line1
line2

! --- inventory ---
inv1

! --- running-config ---
hostname x
`;

describe('section()', () => {
  it('extracts a named section body by comment prefix', () => {
    expect(section(iosCfg, 'version', '! ')).toBe('line1\nline2');
    expect(section(iosCfg, 'inventory', '! ')).toBe('inv1');
  });

  it('reads the final section through to the end', () => {
    expect(section(iosCfg, 'running-config', '! ')).toBe('hostname x');
  });

  it('returns empty for a missing section or a mismatched comment', () => {
    expect(section(iosCfg, 'missing', '! ')).toBe('');
    expect(section(iosCfg, 'version', '# ')).toBe('');
  });

  it('works with the # comment prefix', () => {
    const junos = '# --- version ---\nModel: x\n\n# --- hardware ---\nItem\n';
    expect(section(junos, 'version', '# ')).toBe('Model: x');
    expect(section(junos, 'hardware', '# ')).toBe('Item');
  });
});
