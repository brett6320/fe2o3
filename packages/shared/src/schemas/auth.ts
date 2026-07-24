import { z } from 'zod';
import { orgRoleSchema } from './common.js';

export const emailSchema = z.string().email().max(255).toLowerCase();
export const passwordSchema = z.string().min(10).max(256);
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, hyphens');

export const setupStatusSchema = z.object({ needsSetup: z.boolean() });

export const setupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().max(120).default(''),
  orgName: z.string().min(1).max(120),
  orgSlug: slugSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const orgSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: orgRoleSchema,
});

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  isSuperadmin: z.boolean(),
  totpEnabled: z.boolean(),
  mfaPending: z.boolean(),
  orgs: z.array(orgSummarySchema),
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  isSuperadmin: z.boolean(),
  disabled: z.boolean(),
  totpEnabled: z.boolean(),
  createdAt: z.coerce.date(),
});

export const createUserRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().max(120).default(''),
  isSuperadmin: z.boolean().default(false),
});

export const updateUserRequestSchema = z.object({
  displayName: z.string().max(120).optional(),
  password: passwordSchema.optional(),
  isSuperadmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

export const orgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.coerce.date(),
});

export const createOrgRequestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
});

export const membershipSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string(),
  role: orgRoleSchema,
  email: z.string(),
  displayName: z.string(),
});

export const upsertMembershipRequestSchema = z.object({
  userId: z.string(),
  role: orgRoleSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
