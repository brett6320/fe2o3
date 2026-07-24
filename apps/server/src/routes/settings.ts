import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSuperadmin } from '../auth/plugin.js';
import { settings } from '../db/schema.js';

const settingsSchema = z.object({
  baseUrl: z.string().url().optional(),
  gitAuthorName: z.string().max(120).optional(),
  gitAuthorEmail: z.string().email().optional(),
  concurrency: z.number().int().min(1).max(200).optional(),
});

export const settingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/settings',
    {
      preHandler: requireSuperadmin,
      schema: { tags: ['settings'], response: { 200: settingsSchema } },
    },
    async () => {
      const rows = await app.db.select().from(settings);
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  );

  app.patch(
    '/settings',
    {
      preHandler: requireSuperadmin,
      schema: { tags: ['settings'], body: settingsSchema, response: { 200: settingsSchema } },
    },
    async (req) => {
      for (const [key, value] of Object.entries(req.body)) {
        if (value === undefined) continue;
        await app.db
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } });
      }
      const rows = await app.db.select().from(settings);
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  );
};

/** Read one setting with fallback. */
export async function getSetting<T>(
  db: import('../db/index.js').Db,
  key: string,
  fallback: T,
): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return (row?.value as T) ?? fallback;
}
