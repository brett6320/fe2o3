import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateToken } from '../auth/crypto.js';
import { requireAuth } from '../auth/plugin.js';
import { apiKeys } from '../db/schema.js';

const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scope: z.enum(['read', 'write', 'admin']),
  lastUsedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api-keys',
    {
      preHandler: requireAuth,
      schema: { tags: ['api-keys'], response: { 200: z.array(apiKeySchema) } },
    },
    async (req) =>
      app.db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scope: apiKeys.scope,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, req.auth?.userId ?? '')),
  );

  app.post(
    '/api-keys',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['api-keys'],
        body: z.object({
          name: z.string().min(1).max(120),
          scope: z.enum(['read', 'write', 'admin']).default('read'),
          expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
        }),
        // secret returned exactly once, at creation
        response: { 200: apiKeySchema.extend({ token: z.string() }) },
      },
    },
    async (req) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      const { token, hash } = generateToken();
      const prefix = token.slice(0, 8);
      const fullToken = `fe2o3_${prefix}_${token}`;
      const [row] = await app.db
        .insert(apiKeys)
        .values({
          userId: auth.userId,
          tokenHash: hash,
          prefix,
          name: req.body.name,
          scope: req.body.scope,
          expiresAt: req.body.expiresInDays
            ? new Date(Date.now() + req.body.expiresInDays * 86400_000)
            : null,
        })
        .returning();
      if (!row) throw new Error('failed to create api key');
      return { ...row, token: fullToken };
    },
  );

  app.delete(
    '/api-keys/:id',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['api-keys'],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      await app.db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, auth.userId)));
      return { ok: true };
    },
  );
};
