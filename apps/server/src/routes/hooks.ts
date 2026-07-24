import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrgRole } from '../auth/plugin.js';
import { deliverHook } from '../core/hooks/dispatcher.js';
import { hooks } from '../db/schema.js';
import { respond } from './replies.js';

const orgParams = z.object({ orgId: z.string() });
const orgIdParams = z.object({ orgId: z.string(), id: z.string() });

const hookSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  events: z.array(z.string()),
  type: z.enum(['webhook', 'slack']),
  config: z.record(z.string(), z.string()),
  enabled: z.boolean(),
});

const upsertHookSchema = z.object({
  name: z.string().min(1).max(120),
  events: z.array(z.enum(['backup_changed', 'backup_failed', 'backup_success'])).min(1),
  type: z.enum(['webhook', 'slack']),
  config: z.object({ url: z.string().url(), secret: z.string().optional() }),
  enabled: z.boolean().default(true),
});

export const hookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/orgs/:orgId/hooks',
    {
      preHandler: requireOrgRole('readonly'),
      schema: { tags: ['hooks'], params: orgParams, response: { 200: z.array(hookSchema) } },
    },
    async (req) => app.db.select().from(hooks).where(eq(hooks.orgId, req.params.orgId)),
  );

  app.post(
    '/orgs/:orgId/hooks',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['hooks'],
        params: orgParams,
        body: upsertHookSchema,
        response: { 200: hookSchema },
      },
    },
    async (req) => {
      const config: Record<string, string> = { url: req.body.config.url };
      if (req.body.config.secret) config.secret = req.body.config.secret;
      const [hook] = await app.db
        .insert(hooks)
        .values({
          orgId: req.params.orgId,
          name: req.body.name,
          events: req.body.events,
          type: req.body.type,
          config,
          enabled: req.body.enabled,
        })
        .returning();
      return hook;
    },
  );

  app.patch(
    '/orgs/:orgId/hooks/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['hooks'],
        params: orgIdParams,
        body: upsertHookSchema.partial(),
        response: respond(hookSchema, 404),
      },
    },
    async (req, reply) => {
      const patch: Record<string, unknown> = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.events !== undefined) patch.events = req.body.events;
      if (req.body.type !== undefined) patch.type = req.body.type;
      if (req.body.enabled !== undefined) patch.enabled = req.body.enabled;
      if (req.body.config !== undefined) {
        const config: Record<string, string> = { url: req.body.config.url };
        if (req.body.config.secret) config.secret = req.body.config.secret;
        patch.config = config;
      }
      const [hook] = await app.db
        .update(hooks)
        .set(patch)
        .where(and(eq(hooks.id, req.params.id), eq(hooks.orgId, req.params.orgId)))
        .returning();
      if (!hook) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Hook not found' } as never);
      }
      return hook;
    },
  );

  app.delete(
    '/orgs/:orgId/hooks/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['hooks'],
        params: orgIdParams,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await app.db
        .delete(hooks)
        .where(and(eq(hooks.id, req.params.id), eq(hooks.orgId, req.params.orgId)));
      return { ok: true };
    },
  );

  app.post(
    '/orgs/:orgId/hooks/:id/test',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['hooks'],
        params: orgIdParams,
        response: respond(z.object({ ok: z.boolean(), error: z.string().optional() }), 404),
      },
    },
    async (req, reply) => {
      const [hook] = await app.db
        .select()
        .from(hooks)
        .where(and(eq(hooks.id, req.params.id), eq(hooks.orgId, req.params.orgId)))
        .limit(1);
      if (!hook) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Hook not found' } as never);
      }
      try {
        await deliverHook(hook, {
          event: 'backup_changed',
          orgId: hook.orgId,
          deviceId: 'test-device',
          deviceName: 'test-device',
          commitSha: '0000000000000000000000000000000000000000',
          timestamp: new Date().toISOString(),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
};
