import { z } from 'zod';

export const idSchema = z.string().min(1).max(64);

export const orgRoleSchema = z.enum(['admin', 'operator', 'readonly']);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const errorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
});
