import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { verifyChain } from '../auth/audit-chain.js';
import { requireSuperadmin } from '../auth/plugin.js';
import { auditLog, users } from '../db/schema.js';

const auditEntrySchema = z.object({
  id: z.string(),
  seq: z.number(),
  entryHash: z.string().nullable(),
  userId: z.string().nullable(),
  userEmail: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  action: z.string(),
  resource: z.string(),
  ip: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['audit'],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(1000).default(200),
        }),
        response: { 200: z.array(auditEntrySchema) },
      },
    },
    async (req) =>
      app.db
        .select({
          id: auditLog.id,
          seq: auditLog.seq,
          entryHash: auditLog.entryHash,
          userId: auditLog.userId,
          userEmail: users.email,
          apiKeyId: auditLog.apiKeyId,
          action: auditLog.action,
          resource: auditLog.resource,
          ip: auditLog.ip,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .orderBy(desc(auditLog.createdAt))
        .limit(req.query.limit),
  );

  app.get(
    '/audit/verify',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['audit'],
        response: {
          200: z.object({
            ok: z.boolean(),
            checked: z.number(),
            legacy: z.number(),
            firstInvalidSeq: z.number().nullable(),
          }),
        },
      },
    },
    async () => verifyChain(app.db),
  );
};
