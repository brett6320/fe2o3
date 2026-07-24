import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSuperadmin } from '../auth/plugin.js';
import { devices, jobs, orgs } from '../db/schema.js';

const tenantRowSchema = z.object({
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  devices: z.number(),
  healthy: z.number(),
  failing: z.number(),
  never: z.number(),
  disabled: z.number(),
  lastBackupAt: z.coerce.date().nullable(),
});

const failureSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  orgId: z.string(),
  orgName: z.string(),
  error: z.string().nullable(),
  at: z.coerce.date(),
});

const overviewSchema = z.object({
  totals: z.object({
    tenants: z.number(),
    devices: z.number(),
    healthy: z.number(),
    failing: z.number(),
    never: z.number(),
    disabled: z.number(),
    changes24h: z.number(),
  }),
  tenants: z.array(tenantRowSchema),
  recentFailures: z.array(failureSchema),
});

/** Cross-tenant rollup for superadmins — surfaces problems across every org. */
export const adminOverviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/admin/overview',
    {
      preHandler: requireSuperadmin,
      schema: { tags: ['admin'], response: { 200: overviewSchema } },
    },
    async () => {
      const tenants = await app.db
        .select({
          orgId: orgs.id,
          name: orgs.name,
          slug: orgs.slug,
          devices: sql<number>`count(${devices.id})::int`,
          healthy: sql<number>`count(*) filter (where ${devices.lastStatus} = 'success')::int`,
          failing: sql<number>`count(*) filter (where ${devices.lastStatus} = 'failed')::int`,
          never: sql<number>`count(*) filter (where ${devices.lastStatus} = 'never')::int`,
          disabled: sql<number>`count(*) filter (where ${devices.enabled} = false)::int`,
          lastBackupAt: sql<Date | null>`max(${devices.lastBackupAt})`,
        })
        .from(orgs)
        .leftJoin(devices, eq(devices.orgId, orgs.id))
        .groupBy(orgs.id, orgs.name, orgs.slug)
        // orgs with problems first, then by size
        .orderBy(
          sql`count(*) filter (where ${devices.lastStatus} = 'failed') desc`,
          sql`count(${devices.id}) desc`,
        );

      const recentFailures = await app.db
        .select({
          deviceId: jobs.deviceId,
          deviceName: devices.name,
          orgId: jobs.orgId,
          orgName: orgs.name,
          error: jobs.error,
          at: jobs.createdAt,
        })
        .from(jobs)
        .innerJoin(devices, eq(jobs.deviceId, devices.id))
        .innerJoin(orgs, eq(jobs.orgId, orgs.id))
        .where(eq(jobs.status, 'failed'))
        .orderBy(desc(jobs.createdAt))
        .limit(25);

      const [changes] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            gte(jobs.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
            sql`${jobs.commitSha} is not null`,
          ),
        );

      const totals = tenants.reduce(
        (acc, t) => ({
          tenants: acc.tenants + 1,
          devices: acc.devices + t.devices,
          healthy: acc.healthy + t.healthy,
          failing: acc.failing + t.failing,
          never: acc.never + t.never,
          disabled: acc.disabled + t.disabled,
          changes24h: acc.changes24h,
        }),
        {
          tenants: 0,
          devices: 0,
          healthy: 0,
          failing: 0,
          never: 0,
          disabled: 0,
          changes24h: changes?.n ?? 0,
        },
      );

      return { totals, tenants, recentFailures };
    },
  );
};
