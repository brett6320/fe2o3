import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid());

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
};

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  isSuperadmin: boolean('is_superadmin').notNull().default(false),
  disabled: boolean('disabled').notNull().default(false),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  ...timestamps,
});

export const orgs = pgTable('orgs', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ...timestamps,
});

export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'operator', 'readonly'] }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('org_memberships_org_user').on(t.orgId, t.userId)],
);

export const credentials = pgTable('credentials', {
  id: id(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  username: text('username').notNull().default(''),
  passwordEnc: text('password_enc'),
  enablePasswordEnc: text('enable_password_enc'),
  sshPrivateKeyEnc: text('ssh_private_key_enc'),
  sshKeyPassphraseEnc: text('ssh_key_passphrase_enc'),
  ...timestamps,
});

export const groups = pgTable(
  'groups',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Subdirectory inside the org's git repo. */
    pathSlug: text('path_slug').notNull(),
    defaultCredentialId: text('default_credential_id').references(() => credentials.id, {
      onDelete: 'set null',
    }),
    defaultIntervalSec: integer('default_interval_sec').notNull().default(3600),
    ...timestamps,
  },
  (t) => [uniqueIndex('groups_org_slug').on(t.orgId, t.pathSlug)],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    /** Unique per org; used as the filename inside the git repo. */
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port'),
    protocol: text('protocol', { enum: ['ssh', 'telnet'] })
      .notNull()
      .default('ssh'),
    modelId: text('model_id').notNull(),
    credentialId: text('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
    intervalSec: integer('interval_sec'),
    enabled: boolean('enabled').notNull().default(true),
    vars: jsonb('vars').$type<Record<string, unknown>>().notNull().default({}),
    lastStatus: text('last_status', { enum: ['never', 'running', 'success', 'failed'] })
      .notNull()
      .default('never'),
    lastBackupAt: timestamp('last_backup_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'date' }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('devices_org_name').on(t.orgId, t.name),
    index('devices_next_run').on(t.enabled, t.nextRunAt),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    trigger: text('trigger', { enum: ['scheduled', 'manual'] }).notNull(),
    status: text('status', { enum: ['queued', 'running', 'success', 'failed'] })
      .notNull()
      .default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    error: text('error'),
    /** Session transcript with secrets scrubbed. */
    log: text('log'),
    /** Commit created by this job; null = config unchanged. */
    commitSha: text('commit_sha'),
    ...timestamps,
  },
  (t) => [index('jobs_device_created').on(t.deviceId, t.createdAt)],
);

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: jsonb('transports').$type<string[]>().notNull().default([]),
  name: text('name').notNull().default('Passkey'),
  ...timestamps,
});

export const apiKeys = pgTable('api_keys', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  name: text('name').notNull(),
  scope: text('scope', { enum: ['read', 'write', 'admin'] })
    .notNull()
    .default('read'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  ...timestamps,
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    userId: text('user_id'),
    apiKeyId: text('api_key_id'),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    ...timestamps,
  },
  (t) => [index('audit_created').on(t.createdAt)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  ...timestamps,
});

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mfaPending: boolean('mfa_pending').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  ...timestamps,
});
