import { describe, expect, it } from 'vitest';
import cradlepoint from '../src/core/models/cradlepoint.js';
import digiTransport from '../src/core/models/digi-transport.js';
import edgeos from '../src/core/models/edgeos.js';
import eos from '../src/core/models/eos.js';
import ios from '../src/core/models/ios.js';
import junos from '../src/core/models/junos.js';
import linux from '../src/core/models/linux.js';
import routeros from '../src/core/models/routeros.js';
import {
  parseBsdUptime,
  parseCompactDuration,
  parseJunosUptime,
  parseSeconds,
  parseVerboseDuration,
} from '../src/core/models/uptime.js';

const W = 604800;
const D = 86400;
const H = 3600;
const M = 60;

describe('uptime helpers', () => {
  it('verbose duration', () => {
    expect(parseVerboseDuration('20 weeks, 4 days, 1 hour, 43 minutes')).toBe(
      20 * W + 4 * D + H + 43 * M,
    );
    expect(parseVerboseDuration('3 weeks, 2 days, 1 hour and 5 minutes')).toBe(
      3 * W + 2 * D + H + 5 * M,
    );
    expect(parseVerboseDuration('no duration here')).toBeNull();
  });
  it('compact duration', () => {
    expect(parseCompactDuration('6w6d10h30m15s')).toBe(6 * W + 6 * D + 10 * H + 30 * M + 15);
  });
  it('bsd uptime', () => {
    expect(parseBsdUptime('12:34:56 up 5 days, 3:21, 1 user, load average: 0')).toBe(
      5 * D + 3 * H + 21 * M,
    );
    expect(parseBsdUptime('up 3 mins')).toBe(3 * M);
    expect(parseBsdUptime('up 21:00,')).toBe(21 * H);
  });
  it('plain seconds', () => {
    expect(parseSeconds('350735.47 234388.90')).toBe(350735);
    expect(parseSeconds('"123456"')).toBe(123456);
  });
  it('junos booted parenthetical', () => {
    expect(parseJunosUptime('System booted: 2026-05-01 12:00:00 UTC (12w3d 21:00 ago)')).toBe(
      12 * W + 3 * D + 21 * H,
    );
    expect(parseJunosUptime('System booted: 2026-07-20 08:00:00 UTC (2w 05:00 ago)')).toBe(
      2 * W + 5 * H,
    );
  });
});

describe('per-driver uptime', () => {
  it('ios parses from show version', () => {
    expect(ios.uptime?.parse('router1 uptime is 3 weeks, 2 days, 4 hours, 5 minutes')).toBe(
      3 * W + 2 * D + 4 * H + 5 * M,
    );
  });
  it('junos runs show system uptime', () => {
    expect(junos.uptime?.cmd).toBe('show system uptime');
    expect(junos.uptime?.parse('System booted: 2026-05-01 12:00:00 UTC (2w 05:00 ago)')).toBe(
      2 * W + 5 * H,
    );
  });
  it('routeros runs /system resource print', () => {
    expect(routeros.uptime?.cmd).toBe('/system resource print');
    expect(routeros.uptime?.parse('uptime: 1w2d3h4m5s\nversion: 7.15.1')).toBe(
      W + 2 * D + 3 * H + 4 * M + 5,
    );
  });
  it('eos parses from show version', () => {
    expect(eos.uptime?.parse('Uptime: 5 weeks, 2 days, 23 hours and 12 minutes')).toBe(
      5 * W + 2 * D + 23 * H + 12 * M,
    );
  });
  it('edgeos parses from show version', () => {
    expect(edgeos.uptime?.parse('Uptime: 12:34:56 up 5 days, 3:21, 1 user')).toBe(
      5 * D + 3 * H + 21 * M,
    );
  });
  it('cradlepoint reads status seconds', () => {
    expect(cradlepoint.uptime?.cmd).toBe('get status/system/uptime');
    expect(cradlepoint.uptime?.parse('123456')).toBe(123456);
  });
  it('digi transport (sarian) runs uptime', () => {
    expect(digiTransport.uptime?.cmd).toBe('uptime');
    // "Uptime 96 Hrs 0 Mins 12 Seconds"
    expect(digiTransport.uptime?.parse('Uptime 96 Hrs 0 Mins 12 Seconds')).toBe(96 * H + 12);
  });
  it('linux reads /proc/uptime', () => {
    expect(linux.uptime?.cmd).toBe('cat /proc/uptime');
    expect(linux.uptime?.parse('350735.47 234388.90')).toBe(350735);
  });
});
