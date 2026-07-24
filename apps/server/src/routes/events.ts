import { jobSchema } from '@fe2o3/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrgRole } from '../auth/plugin.js';
import { devices, jobs } from '../db/schema.js';

const orgParams = z.object({ orgId: z.string() });

export const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Server-sent events: job/device status changes for one org. */
  app.get(
    '/orgs/:orgId/events',
    { preHandler: requireOrgRole('readonly'), schema: { hide: true, params: orgParams } },
    async (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      reply.raw.write(': connected\n\n');

      const unsubscribe = app.bus.subscribe((event) => {
        if (event.orgId !== req.params.orgId) return;
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

      req.raw.on('close', () => {
        clearInterval(keepalive);
        unsubscribe();
      });
      // keep the connection open; fastify must not try to serialize a response
      await new Promise(() => {});
    },
  );

  app.get(
    '/orgs/:orgId/jobs',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['jobs'],
        params: orgParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: { 200: z.array(jobSchema) },
      },
    },
    async (req) =>
      app.db
        .select({
          id: jobs.id,
          orgId: jobs.orgId,
          deviceId: jobs.deviceId,
          deviceName: devices.name,
          trigger: jobs.trigger,
          status: jobs.status,
          startedAt: jobs.startedAt,
          finishedAt: jobs.finishedAt,
          error: jobs.error,
          commitSha: jobs.commitSha,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .innerJoin(devices, eq(jobs.deviceId, devices.id))
        .where(eq(jobs.orgId, req.params.orgId))
        .orderBy(desc(jobs.createdAt))
        .limit(req.query.limit),
  );

  app.get(
    '/orgs/:orgId/stats',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['stats'],
        params: orgParams,
        response: {
          200: z.object({
            devices: z.number(),
            enabled: z.number(),
            success: z.number(),
            failed: z.number(),
            never: z.number(),
            changesLast24h: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const [counts] = await app.db
        .select({
          devices: sql<number>`count(*)::int`,
          enabled: sql<number>`count(*) filter (where ${devices.enabled})::int`,
          success: sql<number>`count(*) filter (where ${devices.lastStatus} = 'success')::int`,
          failed: sql<number>`count(*) filter (where ${devices.lastStatus} = 'failed')::int`,
          never: sql<number>`count(*) filter (where ${devices.lastStatus} = 'never')::int`,
        })
        .from(devices)
        .where(eq(devices.orgId, req.params.orgId));
      const [changes] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            eq(jobs.orgId, req.params.orgId),
            gte(jobs.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
            sql`${jobs.commitSha} is not null`,
          ),
        );
      return {
        ...(counts ?? { devices: 0, enabled: 0, success: 0, failed: 0, never: 0 }),
        changesLast24h: changes?.n ?? 0,
      };
    },
  );
};
