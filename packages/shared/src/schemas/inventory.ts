import { z } from 'zod';
import { slugSchema } from './auth.js';

export const credentialSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  username: z.string(),
  hasPassword: z.boolean(),
  hasEnablePassword: z.boolean(),
  hasSshKey: z.boolean(),
  createdAt: z.coerce.date(),
});

export const upsertCredentialRequestSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().max(255).default(''),
  // write-only secrets; omitted = keep existing, empty string = clear
  password: z.string().max(1024).optional(),
  enablePassword: z.string().max(1024).optional(),
  sshPrivateKey: z.string().max(32768).optional(),
  sshKeyPassphrase: z.string().max(1024).optional(),
});

export const groupSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  pathSlug: z.string(),
  defaultCredentialId: z.string().nullable(),
  defaultIntervalSec: z.number().int(),
  deviceCount: z.number().int().optional(),
});

export const upsertGroupRequestSchema = z.object({
  name: z.string().min(1).max(120),
  pathSlug: slugSchema,
  defaultCredentialId: z.string().nullable().optional(),
  defaultIntervalSec: z.number().int().min(60).max(604800).default(3600),
});

export const deviceStatusSchema = z.enum(['never', 'running', 'success', 'failed']);

export const deviceSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  groupId: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int().nullable(),
  protocol: z.enum(['ssh', 'telnet']),
  modelId: z.string(),
  credentialId: z.string().nullable(),
  intervalSec: z.number().int().nullable(),
  enabled: z.boolean(),
  vars: z.record(z.string(), z.unknown()),
  lastStatus: deviceStatusSchema,
  lastBackupAt: z.coerce.date().nullable(),
  lastError: z.string().nullable(),
  nextRunAt: z.coerce.date().nullable(),
  consecutiveFailures: z.number().int(),
  uptimeSeconds: z.number().int().nullable(),
  uptimeCapturedAt: z.coerce.date().nullable(),
});

export const deviceNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, dot, underscore, hyphen');

export const upsertDeviceRequestSchema = z.object({
  name: deviceNameSchema,
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  protocol: z.enum(['ssh', 'telnet']).default('ssh'),
  modelId: z.string().min(1),
  groupId: z.string(),
  credentialId: z.string().nullable().optional(),
  intervalSec: z.number().int().min(60).max(604800).nullable().optional(),
  enabled: z.boolean().default(true),
  vars: z.record(z.string(), z.unknown()).default({}),
  /** Create-only: schedule the first backup immediately instead of after one interval. */
  backupNow: z.boolean().default(false),
});

export const jobSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  deviceId: z.string(),
  deviceName: z.string().optional(),
  trigger: z.enum(['scheduled', 'manual']),
  status: z.enum(['queued', 'running', 'success', 'failed']),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  error: z.string().nullable(),
  commitSha: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const versionSchema = z.object({
  sha: z.string(),
  date: z.string(),
  subject: z.string(),
});

export const driverInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  vars: z
    .array(
      z.object({
        key: z.string(),
        description: z.string(),
        type: z.enum(['string', 'number', 'boolean']),
      }),
    )
    .default([]),
});
