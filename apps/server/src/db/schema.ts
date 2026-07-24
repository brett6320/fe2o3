import { boolean, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
