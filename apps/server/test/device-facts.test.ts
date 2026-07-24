import { describe, expect, it } from 'vitest';
import ios from '../src/core/models/ios.js';

const config = `! --- version ---
Cisco IOS Software, C3560 Software (C3560-IPSERVICESK9-M), Version 12.2(55)SE, RELEASE SOFTWARE (fc2)
Technical Support: http://www.cisco.com/techsupport

cisco WS-C3560-48PS (PowerPC405) processor (revision C0) with 122880K/8184K bytes of memory.
Processor board ID FDO1441Z0YE
Model number                    : WS-C3560-48PS-S
System serial number            : FDO1441Z0YE

! --- inventory ---
NAME: "1", DESCR: "WS-C3560-48PS-S"
PID: WS-C3560-48PS-S   , VID: V05, SN: FDO1441Z0YE

NAME: "GigabitEthernet0/49", DESCR: "1000BaseSX SFP"
PID: GLC-SX-MM         , VID: V01, SN: SN12345678

! --- running-config ---
hostname sw1
end
`;

describe('ios facts parser', () => {
  it('parses serial, model, version and inventory', () => {
    const facts = ios.facts?.(config);
    expect(facts).not.toBeNull();
    expect(facts?.serial).toBe('FDO1441Z0YE');
    expect(facts?.model).toBe('WS-C3560-48PS-S');
    expect(facts?.osVersion).toBe('12.2(55)SE');
    expect(facts?.inventory).toHaveLength(2);
    expect(facts?.inventory?.[0]).toMatchObject({
      name: '1',
      pid: 'WS-C3560-48PS-S',
      serial: 'FDO1441Z0YE',
    });
    expect(facts?.inventory?.[1]).toMatchObject({
      description: '1000BaseSX SFP',
      pid: 'GLC-SX-MM',
      serial: 'SN12345678',
    });
  });

  it('returns null when the config has no recognizable facts', () => {
    expect(ios.facts?.('! --- running-config ---\nhostname x\nend\n')).toBeNull();
  });
});
