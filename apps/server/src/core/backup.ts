import { eq } from 'drizzle-orm';
import { decryptSecret } from '../auth/crypto.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { credentials, devices, groups, jobs, orgs } from '../db/schema.js';
import { deviceVarSecret } from './device-vars.js';
import { runBackup } from './executor.js';
import { getOrgRepo } from './git/repo.js';
import type { DriverRegistry } from './models/registry.js';

export interface BackupOutcome {
  jobId: string;
  status: 'success' | 'failed';
  commitSha: string | null;
  error?: string;
}

/** Run a backup for one device end-to-end: session, scrub, commit, job row. */
export async function backupDevice(
  ctx: { db: Db; config: AppConfig; registry: DriverRegistry },
  deviceId: string,
  trigger: 'scheduled' | 'manual',
): Promise<BackupOutcome> {
  const { db, config, registry } = ctx;

  const [row] = await db
    .select({
      device: devices,
      group: groups,
      org: orgs,
    })
    .from(devices)
    .innerJoin(groups, eq(devices.groupId, groups.id))
    .innerJoin(orgs, eq(devices.orgId, orgs.id))
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (!row) throw new Error(`device ${deviceId} not found`);
  const { device, group, org } = row;

  const driver = registry.get(device.modelId);
  if (!driver) throw new Error(`unknown driver model: ${device.modelId}`);

  const credentialId = device.credentialId ?? group.defaultCredentialId;
  if (!credentialId) throw new Error('no credential assigned to device or group');
  const [cred] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, credentialId))
    .limit(1);
  if (!cred) throw new Error('credential not found');

  const [job] = await db
    .insert(jobs)
    .values({
      orgId: device.orgId,
      deviceId: device.id,
      trigger,
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: jobs.id });
  if (!job) throw new Error('failed to create job');
  await db.update(devices).set({ lastStatus: 'running' }).where(eq(devices.id, device.id));

  const dec = (v: string | null) => (v ? decryptSecret(v, config.keyring) : undefined);

  try {
    const loginSuffix =
      typeof device.vars.loginSuffix === 'string'
        ? device.vars.loginSuffix
        : device.modelId === 'routeros'
          ? '+ct200w'
          : '';
    const result = await runBackup({
      driver,
      protocol: device.protocol,
      connect: {
        host: device.host,
        port: device.port ?? (device.protocol === 'telnet' ? 23 : 22),
        username: cred.username + loginSuffix,
        password: dec(cred.passwordEnc),
        privateKey: dec(cred.sshPrivateKeyEnc),
        passphrase: dec(cred.sshKeyPassphraseEnc),
      },
      enablePassword:
        deviceVarSecret(device.vars, 'enablePassword', config.keyring) ??
        dec(cred.enablePasswordEnc),
    });

    const repo = await getOrgRepo(config.reposDir, org.slug);
    const commitSha = await repo.commitConfig({
      groupSlug: group.pathSlug,
      deviceName: device.name,
      content: result.configText,
      message: `${device.name}: backup (${trigger})`,
    });

    // Scrub credential values from the stored transcript
    let log = result.transcript;
    for (const secret of [dec(cred.passwordEnc), dec(cred.enablePasswordEnc)]) {
      if (secret) log = log.split(secret).join('<secret hidden>');
    }

    await db
      .update(jobs)
      .set({ status: 'success', finishedAt: new Date(), commitSha, log })
      .where(eq(jobs.id, job.id));
    await db
      .update(devices)
      .set({
        lastStatus: 'success',
        lastBackupAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
      })
      .where(eq(devices.id, device.id));

    return { jobId: job.id, status: 'success', commitSha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(jobs)
      .set({ status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(jobs.id, job.id));
    await db
      .update(devices)
      .set({
        lastStatus: 'failed',
        lastError: message,
        consecutiveFailures: device.consecutiveFailures + 1,
      })
      .where(eq(devices.id, device.id));
    return { jobId: job.id, status: 'failed', commitSha: null, error: message };
  }
}
