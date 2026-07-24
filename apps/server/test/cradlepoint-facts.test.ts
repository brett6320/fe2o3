import { describe, expect, it } from 'vitest';
import cradlepoint from '../src/core/models/cradlepoint.js';

const config = `# --- product-info ---
{
    "company_name": "Cradlepoint, Inc.",
    "copyright": "Ericsson Enterprise Solutions, Inc. 2024",
    "has_activation_key": false,
    "mac0": "00:30:44:81:de:14",
    "manufacturing": {
        "board_ID": "182047",
        "mftr_date": "2239",
        "serial_num": "MM223900002703"
    },
    "product_name": "E300-C18B",
    "soc_serial": "0xb9abc6c7"
}

# --- config ---
{}
`;

describe('cradlepoint facts parser', () => {
  it('parses model and serial from product-info JSON', () => {
    const f = cradlepoint.facts?.(config);
    expect(f).not.toBeNull();
    expect(f?.model).toBe('E300-C18B');
    expect(f?.serial).toBe('MM223900002703');
    expect(f?.inventory).toHaveLength(1);
    expect(f?.inventory?.[0]).toMatchObject({
      name: 'E300-C18B',
      pid: 'E300-C18B',
      serial: 'MM223900002703',
    });
    expect(f?.inventory?.[0]?.description).toContain('board 182047');
    expect(f?.inventory?.[0]?.description).toContain('MAC 00:30:44:81:de:14');
  });

  it('returns null when product-info is absent or not JSON', () => {
    expect(cradlepoint.facts?.('# --- config ---\n{}\n')).toBeNull();
    expect(cradlepoint.facts?.('# --- product-info ---\nnot json\n')).toBeNull();
  });
});
