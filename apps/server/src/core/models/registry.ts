import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { DriverSpec } from '@fe2o3/driver-sdk';
import cradlepoint from './cradlepoint.js';
import digiDal from './digi-dal.js';
import edgeos from './edgeos.js';
import eos from './eos.js';
import ios from './ios.js';
import junos from './junos.js';
import linux from './linux.js';
import routeros from './routeros.js';

const builtins: DriverSpec[] = [ios, junos, eos, routeros, edgeos, cradlepoint, digiDal, linux];

export class DriverRegistry {
  private drivers = new Map<string, DriverSpec>();

  constructor() {
    for (const d of builtins) this.drivers.set(d.id, d);
  }

  /** Load `*.mjs` plugin drivers dropped into the data dir (restart to pick up). */
  async loadPlugins(dir: string) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
    } catch {
      return;
    }
    for (const file of files) {
      const mod = await import(pathToFileURL(`${dir}/${file}`).href);
      const spec = mod.default as DriverSpec | undefined;
      if (spec?.id && spec.prompt && Array.isArray(spec.commands)) {
        this.drivers.set(spec.id, spec);
      }
    }
  }

  get(id: string): DriverSpec | undefined {
    return this.drivers.get(id);
  }

  list(): DriverSpec[] {
    return [...this.drivers.values()];
  }

  register(spec: DriverSpec) {
    this.drivers.set(spec.id, spec);
  }
}
