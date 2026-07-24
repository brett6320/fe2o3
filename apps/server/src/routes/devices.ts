import { deviceSchema, jobSchema, upsertDeviceRequestSchema, versionSchema } from '@fe2o3/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrgRole } from '../auth/plugin.js';
import { backupDevice, collectDevice } from '../core/backup.js';
import { publicDeviceVars, sealDeviceVars } from '../core/device-vars.js';
import { getOrgRepo } from '../core/git/repo.js';
import { devices, groups, jobs, orgs } from '../db/schema.js';
import { respond } from './replies.js';

const orgParams = z.object({ orgId: z.string() });
const orgIdParams = z.object({ orgId: z.string(), id: z.string() });

const inventoryItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  pid: z.string().optional(),
  serial: z.string().optional(),
});
const deviceFactsSchema = z.object({
  serial: z.string().optional(),
  model: z.string().optional(),
  osVersion: z.string().optional(),
  inventory: z.array(inventoryItemSchema).optional(),
});
const factsResponseSchema = z.object({
  hasConfig: z.boolean(),
  latestSha: z.string().nullable(),
  facts: deviceFactsSchema.nullable(),
});

export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  const findDevice = async (orgId: string, id: string) => {
    const [row] = await app.db
      .select({ device: devices, group: groups, org: orgs })
      .from(devices)
      .innerJoin(groups, eq(devices.groupId, groups.id))
      .innerJoin(orgs, eq(devices.orgId, orgs.id))
      .where(and(eq(devices.id, id), eq(devices.orgId, orgId)))
      .limit(1);
    return row;
  };

  app.get(
    '/orgs/:orgId/devices',
    {
      preHandler: requireOrgRole('readonly'),
      schema: { tags: ['devices'], params: orgParams, response: { 200: z.array(deviceSchema) } },
    },
    async (req) => {
      const rows = await app.db.select().from(devices).where(eq(devices.orgId, req.params.orgId));
      return rows.map((d) => ({ ...d, vars: publicDeviceVars(d.vars) }));
    },
  );

  app.get(
    '/orgs/:orgId/devices/:id',
    {
      preHandler: requireOrgRole('readonly'),
      schema: { tags: ['devices'], params: orgIdParams, response: respond(deviceSchema, 404) },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      return { ...row.device, vars: publicDeviceVars(row.device.vars) };
    },
  );

  app.post(
    '/orgs/:orgId/devices',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['devices'],
        params: orgParams,
        body: upsertDeviceRequestSchema,
        response: respond(deviceSchema, 400, 409),
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (!app.registry.get(b.modelId)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Unknown model: ${b.modelId}`,
        } as never);
      }
      const [group] = await app.db
        .select({ id: groups.id, defaultIntervalSec: groups.defaultIntervalSec })
        .from(groups)
        .where(and(eq(groups.id, b.groupId), eq(groups.orgId, req.params.orgId)))
        .limit(1);
      if (!group) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Group not in this org',
        } as never);
      }
      const [existing] = await app.db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.orgId, req.params.orgId), eq(devices.name, b.name)))
        .limit(1);
      if (existing) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Device name already in use',
        } as never);
      }
      const [device] = await app.db
        .insert(devices)
        .values({
          orgId: req.params.orgId,
          groupId: b.groupId,
          name: b.name,
          host: b.host,
          port: b.port ?? null,
          protocol: b.protocol,
          modelId: b.modelId,
          credentialId: b.credentialId ?? null,
          intervalSec: b.intervalSec ?? null,
          enabled: b.enabled,
          vars: sealDeviceVars(b.vars, undefined, app.config.keyring),
          nextRunAt: b.backupNow
            ? new Date()
            : new Date(Date.now() + (b.intervalSec ?? group.defaultIntervalSec) * 1000),
        })
        .returning();
      return device ? { ...device, vars: publicDeviceVars(device.vars) } : device;
    },
  );

  app.patch(
    '/orgs/:orgId/devices/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['devices'],
        params: orgIdParams,
        body: upsertDeviceRequestSchema.partial(),
        response: respond(deviceSchema, 404),
      },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      const b = req.body;

      // Renames / group moves also move the file in git history
      if (
        (b.name && b.name !== row.device.name) ||
        (b.groupId && b.groupId !== row.device.groupId)
      ) {
        let toGroupSlug = row.group.pathSlug;
        if (b.groupId && b.groupId !== row.device.groupId) {
          const [g] = await app.db
            .select()
            .from(groups)
            .where(and(eq(groups.id, b.groupId), eq(groups.orgId, req.params.orgId)))
            .limit(1);
          if (!g) {
            return reply.code(404).send({
              statusCode: 404,
              error: 'Not Found',
              message: 'Target group not found',
            } as never);
          }
          toGroupSlug = g.pathSlug;
        }
        const repo = await getOrgRepo(app.config.reposDir, row.org.slug);
        await repo.moveDevice({
          fromGroup: row.group.pathSlug,
          fromName: row.device.name,
          toGroup: toGroupSlug,
          toName: b.name ?? row.device.name,
        });
      }

      const patch: Record<string, unknown> = {};
      for (const key of [
        'name',
        'host',
        'port',
        'protocol',
        'modelId',
        'groupId',
        'credentialId',
        'intervalSec',
        'enabled',
        'vars',
      ] as const) {
        if (b[key] !== undefined) patch[key] = b[key];
      }
      if (b.vars !== undefined) {
        patch.vars = sealDeviceVars(b.vars, row.device.vars, app.config.keyring);
      }
      const [device] = await app.db
        .update(devices)
        .set(patch)
        .where(eq(devices.id, req.params.id))
        .returning();
      return device ? { ...device, vars: publicDeviceVars(device.vars) } : device;
    },
  );

  app.delete(
    '/orgs/:orgId/devices/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['devices'],
        params: orgIdParams,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await app.db
        .delete(devices)
        .where(and(eq(devices.id, req.params.id), eq(devices.orgId, req.params.orgId)));
      return { ok: true };
    },
  );

  app.post(
    '/orgs/:orgId/devices/:id/backup',
    {
      preHandler: requireOrgRole('operator'),
      schema: {
        tags: ['devices'],
        params: orgIdParams,
        response: respond(
          z.object({
            jobId: z.string(),
            status: z.enum(['success', 'failed']),
            commitSha: z.string().nullable(),
            error: z.string().optional(),
          }),
          404,
        ),
      },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      app.bus.publish({
        type: 'job.started',
        orgId: req.params.orgId,
        deviceId: row.device.id,
        deviceName: row.device.name,
      });
      // Route manual backups through the collector pool when available so they
      // run on a worker thread like scheduled ones; fall back to inline.
      const ctx = { db: app.db, config: app.config, registry: app.registry, log: app.log };
      const pool = app.collectorPool;
      const outcome = pool
        ? await collectDevice(ctx, pool.submit, row.device.id, 'manual')
        : await backupDevice(ctx, row.device.id, 'manual');
      app.bus.publish({
        type: 'job.finished',
        orgId: req.params.orgId,
        deviceId: row.device.id,
        deviceName: row.device.name,
        jobId: outcome.jobId,
        status: outcome.status,
        commitSha: outcome.commitSha,
      });
      return outcome;
    },
  );

  app.get(
    '/orgs/:orgId/devices/:id/versions',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['devices'],
        params: orgIdParams,
        response: respond(z.array(versionSchema), 404),
      },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      const repo = await getOrgRepo(app.config.reposDir, row.org.slug);
      return repo.listVersions(row.group.pathSlug, row.device.name);
    },
  );

  app.get(
    '/orgs/:orgId/devices/:id/versions/:sha',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['devices'],
        params: orgIdParams.extend({ sha: z.string().regex(/^[0-9a-f]{4,40}$/) }),
        response: respond(z.object({ content: z.string() }), 404),
      },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      const repo = await getOrgRepo(app.config.reposDir, row.org.slug);
      const content = await repo.showVersion(row.group.pathSlug, row.device.name, req.params.sha);
      if (content === null) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Version not found' } as never);
      }
      return { content };
    },
  );

  app.get(
    '/orgs/:orgId/devices/:id/facts',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['devices'],
        params: orgIdParams,
        response: respond(factsResponseSchema, 404),
      },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      // Parse facts on demand from the latest stored config — nothing to persist,
      // and drivers without a parser simply return no facts.
      const repo = await getOrgRepo(app.config.reposDir, row.org.slug);
      const [latest] = await repo.listVersions(row.group.pathSlug, row.device.name, 1);
      if (!latest) return { hasConfig: false, latestSha: null, facts: null };
      const content = await repo.showVersion(row.group.pathSlug, row.device.name, latest.sha);
      const facts =
        content != null ? (app.registry.get(row.device.modelId)?.facts?.(content) ?? null) : null;
      return { hasConfig: content != null, latestSha: latest.sha, facts };
    },
  );

  app.get(
    '/orgs/:orgId/devices/:id/diff',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['devices'],
        params: orgIdParams,
        querystring: z.object({
          from: z.string().regex(/^[0-9a-f]{4,40}$/),
          to: z.string().regex(/^[0-9a-f]{4,40}$/),
        }),
        response: respond(z.object({ diff: z.string() }), 404),
      },
    },
    async (req, reply) => {
      const row = await findDevice(req.params.orgId, req.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }
      const repo = await getOrgRepo(app.config.reposDir, row.org.slug);
      return {
        diff: await repo.diff(row.group.pathSlug, row.device.name, req.query.from, req.query.to),
      };
    },
  );

  app.get(
    '/orgs/:orgId/devices/:id/jobs',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['jobs'],
        params: orgIdParams,
        response: { 200: z.array(jobSchema) },
      },
    },
    async (req) =>
      app.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.deviceId, req.params.id), eq(jobs.orgId, req.params.orgId)))
        .orderBy(desc(jobs.createdAt))
        .limit(50),
  );

  app.get(
    '/orgs/:orgId/jobs/:id',
    {
      preHandler: requireOrgRole('operator'),
      schema: {
        tags: ['jobs'],
        params: orgIdParams,
        response: respond(jobSchema.extend({ log: z.string().nullable() }), 404),
      },
    },
    async (req, reply) => {
      const [job] = await app.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, req.params.id), eq(jobs.orgId, req.params.orgId)))
        .limit(1);
      if (!job) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Job not found' } as never);
      }
      return job;
    },
  );
};
