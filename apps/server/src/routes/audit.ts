import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSuperadmin } from '../auth/plugin.js';
import { auditLog, users } from '../db/schema.js';

const auditEntrySchema = z.object({
  id: z.string(),
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
};
