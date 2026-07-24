import { describe, expect, it } from 'vitest';
import junos from '../src/core/models/junos.js';

const srx240 = `# --- version ---
Model: srx240b
JUNOS Software Release [12.1X46-D86]


# --- hardware ---
Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                AF1310AA0242      SRX240B
Routing Engine   REV 38   750-021792   AABN1488          RE-SRX240B
FPC 0                                                    FPC
  PIC 0                                                  16x GE Base PIC
Power Supply 0


# --- configuration ---
version 12.1X46-D86;
`;

const srx300 = `# --- version ---
Model: srx300
Junos: 22.4R3-S2.11
JUNOS Software Release [22.4R3-S2.11]


# --- hardware ---
Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                CV3316AF0125      SRX300
Routing Engine   REV 0x08 650-065039   CV3316AF0125      RE-SRX300
FPC 0                     BUILTIN      BUILTIN           FPC
  PIC 0                                                  6xGE,2xGE SFP Base PIC
Power Supply 0
`;

describe('junos facts parser', () => {
  it('parses an SRX240 (version via bracketed release)', () => {
    const f = junos.facts?.(srx240);
    expect(f).not.toBeNull();
    expect(f?.model).toBe('srx240b');
    expect(f?.osVersion).toBe('12.1X46-D86');
    expect(f?.serial).toBe('AF1310AA0242');
    // top-level items: Chassis, Routing Engine, FPC 0, Power Supply 0
    expect(f?.inventory).toHaveLength(4);
    const re = f?.inventory?.find((i) => i.name === 'Routing Engine');
    expect(re).toMatchObject({ pid: '750-021792', serial: 'AABN1488', description: 'RE-SRX240B' });
    // PIC 0 is nested under FPC 0
    const fpc = f?.inventory?.find((i) => i.name === 'FPC 0');
    expect(fpc?.children?.[0]).toMatchObject({ name: 'PIC 0', description: '16x GE Base PIC' });
  });

  it('parses an SRX300 (version via Junos: line)', () => {
    const f = junos.facts?.(srx300);
    expect(f?.model).toBe('srx300');
    expect(f?.osVersion).toBe('22.4R3-S2.11');
    expect(f?.serial).toBe('CV3316AF0125');
    const fpc = f?.inventory?.find((i) => i.name === 'FPC 0');
    expect(fpc).toMatchObject({ pid: 'BUILTIN', serial: 'BUILTIN' });
    expect(fpc?.children?.[0]?.name).toBe('PIC 0');
  });

  it('parses a 3-level tree (FPC → PIC → Xcvr) with multiple FPCs', () => {
    const srx345 = `# --- version ---
Model: srx345
Junos: 23.4R2-S2.1
JUNOS Software Release [23.4R2-S2.1]


# --- hardware ---
Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                CZ1716AF0366      SRX345
Routing Engine   REV 0x06 650-065042   CZ1716AF0366      RE-SRX345
FPC 0                     BUILTIN      BUILTIN           FPC
  PIC 0                                                  8xGE,8xGE SFP Base PIC
    Xcvr 8                NON-JNPR     G2310030104       SFP-LX10
FPC 1            REV 06   650-073958   AK10002538        FPC
  PIC 0                                                  LTE for AE mPIM
Power Supply 0
`;
    const f = junos.facts?.(srx345);
    expect(f?.model).toBe('srx345');
    expect(f?.osVersion).toBe('23.4R2-S2.1');
    expect(f?.serial).toBe('CZ1716AF0366');
    // top level: Chassis, Routing Engine, FPC 0, FPC 1, Power Supply 0
    expect(f?.inventory?.map((i) => i.name)).toEqual([
      'Chassis',
      'Routing Engine',
      'FPC 0',
      'FPC 1',
      'Power Supply 0',
    ]);
    const fpc0 = f?.inventory?.find((i) => i.name === 'FPC 0');
    const pic0 = fpc0?.children?.[0];
    expect(pic0?.name).toBe('PIC 0');
    // Xcvr nested one level deeper under PIC 0
    expect(pic0?.children?.[0]).toMatchObject({
      name: 'Xcvr 8',
      pid: 'NON-JNPR',
      serial: 'G2310030104',
      description: 'SFP-LX10',
    });
    const fpc1 = f?.inventory?.find((i) => i.name === 'FPC 1');
    expect(fpc1).toMatchObject({ pid: '650-073958', serial: 'AK10002538' });
    expect(fpc1?.children?.[0]?.name).toBe('PIC 0');
  });

  it('returns null when there is nothing to parse', () => {
    expect(junos.facts?.('# --- configuration ---\nversion 1;\n')).toBeNull();
  });
});
