import { eq } from 'drizzle-orm';
import { decryptSecret } from '../auth/crypto.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { credentials, devices, groups, jobs, orgs } from '../db/schema.js';
import { InlineCollector } from './collector/inline.js';
import type { CollectResult, CollectTask, TaskRunner } from './collector/types.js';
import { deviceVarSecret } from './device-vars.js';
import { getOrgRepo } from './git/repo.js';
import type { DriverRegistry } from './models/registry.js';

export interface BackupOutcome {
  jobId: string;
  status: 'success' | 'failed';
  commitSha: string | null;
  error?: string;
}

export interface BackupContext {
  db: Db;
  config: AppConfig;
  registry: DriverRegistry;
  log?: { warn?: (o: unknown, m: string) => void };
}

type DeviceRow = typeof devices.$inferSelect;
type GroupRow = typeof groups.$inferSelect;
type OrgRow = typeof orgs.$inferSelect;

interface FinalizeContext {
  jobId: string;
  trigger: 'scheduled' | 'manual';
  device: DeviceRow;
  group: GroupRow;
  org: OrgRow;
  /** Plaintext secrets to redact from the stored transcript. */
  scrubSecrets: (string | undefined)[];
}

type PrepareResult =
  | { kind: 'skipped'; outcome: BackupOutcome }
  | { kind: 'ready'; task: CollectTask; finalize: FinalizeContext };

/**
 * Main-thread preparation for one backup: read the device/credential, mark a
 * running job, decrypt secrets, and assemble a serializable CollectTask. All
 * DB/keyring access lives here so collectors stay dumb.
 */
export async function prepareCollect(
  ctx: BackupContext,
  deviceId: string,
  trigger: 'scheduled' | 'manual',
): Promise<PrepareResult> {
  const { db, config, registry } = ctx;

  const [row] = await db
    .select({ device: devices, group: groups, org: orgs })
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
  const [cred] = credentialId
    ? await db.select().from(credentials).where(eq(credentials.id, credentialId)).limit(1)
    : [];

  // No usable credential is a configuration problem that won't self-heal (e.g.
  // after a cross-org move clears the device's org-scoped credential). Disable
  // the device so the scheduler stops retrying, record a failed job explaining
  // why, and return a failed outcome instead of throwing.
  if (!cred) {
    const message =
      'No credential assigned to this device or its group — device disabled until a credential is set';
    const [failed] = await db
      .insert(jobs)
      .values({
        orgId: device.orgId,
        deviceId: device.id,
        trigger,
        status: 'failed',
        startedAt: new Date(),
        finishedAt: new Date(),
        error: message,
      })
      .returning({ id: jobs.id });
    await db
      .update(devices)
      .set({ enabled: false, lastStatus: 'failed', lastError: message, nextRunAt: null })
      .where(eq(devices.id, device.id));
    return {
      kind: 'skipped',
      outcome: { jobId: failed?.id ?? '', status: 'failed', commitSha: null, error: message },
    };
  }

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
  const loginSuffix =
    typeof device.vars.loginSuffix === 'string'
      ? device.vars.loginSuffix
      : device.modelId === 'routeros'
        ? '+ct200w'
        : '';

  const task: CollectTask = {
    jobId: job.id,
    deviceId: device.id,
    deviceName: device.name,
    driverId: device.modelId,
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
      deviceVarSecret(device.vars, 'enablePassword', config.keyring) ?? dec(cred.enablePasswordEnc),
  };

  return {
    kind: 'ready',
    task,
    finalize: {
      jobId: job.id,
      trigger,
      device,
      group,
      org,
      scrubSecrets: [dec(cred.passwordEnc), dec(cred.enablePasswordEnc)],
    },
  };
}

/** Main-thread completion: commit to git, mirror, redact + persist the result. */
export async function finalizeCollect(
  ctx: BackupContext,
  fin: FinalizeContext,
  result: CollectResult,
): Promise<BackupOutcome> {
  const { db, config } = ctx;
  const { device, group, org, jobId } = fin;

  const markFailed = async (raw: string): Promise<BackupOutcome> => {
    const message = raw.replaceAll('\u0000', '');
    await db
      .update(jobs)
      .set({ status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(jobs.id, jobId));
    await db
      .update(devices)
      .set({
        lastStatus: 'failed',
        lastError: message,
        consecutiveFailures: device.consecutiveFailures + 1,
      })
      .where(eq(devices.id, device.id));
    return { jobId, status: 'failed', commitSha: null, error: message };
  };

  if (!result.ok) return markFailed(result.error ?? 'collection failed');

  try {
    const repo = await getOrgRepo(config.reposDir, org.slug);
    const commitSha = await repo.commitConfig({
      groupSlug: group.pathSlug,
      deviceName: device.name,
      content: result.configText ?? '',
      message: `${device.name}: backup (${fin.trigger})`,
    });

    // Mirror the org repo to its external remote when the config changed.
    if (commitSha && org.mirrorUrl) {
      const dec = (v: string | null) => (v ? decryptSecret(v, config.keyring) : undefined);
      repo
        .mirror({
          url: org.mirrorUrl,
          branch: org.mirrorBranch,
          token: dec(org.mirrorTokenEnc),
          sshKey: dec(org.mirrorSshKeyEnc),
        })
        .catch((err) => ctx.log?.warn?.({ err, org: org.slug }, 'mirror push failed'));
    }

    // Redact credential values from the stored transcript.
    let log = result.transcript ?? '';
    for (const secret of fin.scrubSecrets) {
      if (secret) log = log.split(secret).join('<secret hidden>');
    }

    await db
      .update(jobs)
      .set({ status: 'success', finishedAt: new Date(), commitSha, log })
      .where(eq(jobs.id, jobId));
    await db
      .update(devices)
      .set({
        lastStatus: 'success',
        lastBackupAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        // Uptime is a stat, recorded independently of whether the config changed.
        ...(result.uptimeSeconds != null
          ? { uptimeSeconds: result.uptimeSeconds, uptimeCapturedAt: new Date() }
          : {}),
      })
      .where(eq(devices.id, device.id));

    return { jobId, status: 'success', commitSha };
  } catch (err) {
    return markFailed(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Run one device backup through a given task runner (a worker pool, a single
 * collector, or inline): prepare → run → finalize.
 */
export async function collectDevice(
  ctx: BackupContext,
  run: TaskRunner,
  deviceId: string,
  trigger: 'scheduled' | 'manual',
): Promise<BackupOutcome> {
  const prep = await prepareCollect(ctx, deviceId, trigger);
  if (prep.kind === 'skipped') return prep.outcome;
  const result = await run(prep.task);
  return finalizeCollect(ctx, prep.finalize, result);
}

/** Run a backup end-to-end on the main thread (no worker pool). */
export async function backupDevice(
  ctx: BackupContext,
  deviceId: string,
  trigger: 'scheduled' | 'manual',
): Promise<BackupOutcome> {
  const inline = new InlineCollector(ctx.registry);
  return collectDevice(ctx, (t) => inline.run(t), deviceId, trigger);
}
