import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrgRole } from '../auth/plugin.js';
import { getOrgRepo } from '../core/git/repo.js';
import type { Db } from '../db/index.js';
import { devices, groups, jobs, orgMemberships, orgs } from '../db/schema.js';
import { respond } from './replies.js';

/** Caller must be admin in the target org (superadmins pass everywhere). */
async function assertTargetAdmin(
  db: Db,
  auth: { userId: string; isSuperadmin: boolean },
  orgId: string,
): Promise<boolean> {
  if (auth.isSuperadmin) return true;
  const [m] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, auth.userId)))
    .limit(1);
  return m?.role === 'admin';
}

/** Copy one device's latest config from its source repo into the target repo. */
async function moveConfigAcrossRepos(
  reposDir: string,
  opts: {
    fromOrgSlug: string;
    toOrgSlug: string;
    fromGroupSlug: string;
    toGroupSlug: string;
    deviceName: string;
  },
): Promise<void> {
  const fromRepo = await getOrgRepo(reposDir, opts.fromOrgSlug);
  const content = await fromRepo.showVersion(opts.fromGroupSlug, opts.deviceName, 'HEAD');
  if (content !== null) {
    const toRepo = await getOrgRepo(reposDir, opts.toOrgSlug);
    await toRepo.commitConfig({
      groupSlug: opts.toGroupSlug,
      deviceName: opts.deviceName,
      content,
      message: `${opts.deviceName}: moved in from ${opts.fromOrgSlug}`,
    });
  }
  await fromRepo.removeDevice({ groupSlug: opts.fromGroupSlug, deviceName: opts.deviceName });
}

export const moveRoutes: FastifyPluginAsyncZod = async (app) => {
  const orgIdParams = z.object({ orgId: z.string(), id: z.string() });

  // ---- move a single device to another org ----
  app.post(
    '/orgs/:orgId/devices/:id/move',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['moves'],
        params: orgIdParams,
        body: z.object({ toOrgId: z.string(), toGroupId: z.string() }),
        response: respond(z.object({ ok: z.boolean() }), 400, 403, 404, 409),
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      if (!auth) return;
      const { toOrgId, toGroupId } = req.body;
      if (!(await assertTargetAdmin(app.db, auth, toOrgId))) {
        return reply
          .code(403)
          .send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin required in the target org',
          } as never);
      }

      const [row] = await app.db
        .select({ device: devices, group: groups, org: orgs })
        .from(devices)
        .innerJoin(groups, eq(devices.groupId, groups.id))
        .innerJoin(orgs, eq(devices.orgId, orgs.id))
        .where(and(eq(devices.id, req.params.id), eq(devices.orgId, req.params.orgId)))
        .limit(1);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Device not found' } as never);
      }

      const [toGroup] = await app.db
        .select({ group: groups, org: orgs })
        .from(groups)
        .innerJoin(orgs, eq(groups.orgId, orgs.id))
        .where(and(eq(groups.id, toGroupId), eq(groups.orgId, toOrgId)))
        .limit(1);
      if (!toGroup) {
        return reply
          .code(400)
          .send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Target group not in target org',
          } as never);
      }

      const [clash] = await app.db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.orgId, toOrgId), eq(devices.name, row.device.name)))
        .limit(1);
      if (clash) {
        return reply
          .code(409)
          .send({
            statusCode: 409,
            error: 'Conflict',
            message: 'A device with this name already exists in the target org',
          } as never);
      }

      await moveConfigAcrossRepos(app.config.reposDir, {
        fromOrgSlug: row.org.slug,
        toOrgSlug: toGroup.org.slug,
        fromGroupSlug: row.group.pathSlug,
        toGroupSlug: toGroup.group.pathSlug,
        deviceName: row.device.name,
      });

      // Credentials are org-scoped and can't follow — clear for reassignment.
      await app.db
        .update(devices)
        .set({ orgId: toOrgId, groupId: toGroupId, credentialId: null, nextRunAt: new Date() })
        .where(eq(devices.id, row.device.id));
      await app.db.update(jobs).set({ orgId: toOrgId }).where(eq(jobs.deviceId, row.device.id));

      return { ok: true };
    },
  );

  // ---- move a whole group (with its devices) to another org ----
  app.post(
    '/orgs/:orgId/groups/:id/move',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['moves'],
        params: orgIdParams,
        body: z.object({ toOrgId: z.string() }),
        response: respond(
          z.object({ ok: z.boolean(), movedDevices: z.number() }),
          400,
          403,
          404,
          409,
        ),
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      if (!auth) return;
      const { toOrgId } = req.body;
      if (toOrgId === req.params.orgId) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Already in that org' } as never);
      }
      if (!(await assertTargetAdmin(app.db, auth, toOrgId))) {
        return reply
          .code(403)
          .send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin required in the target org',
          } as never);
      }

      const [row] = await app.db
        .select({ group: groups, org: orgs })
        .from(groups)
        .innerJoin(orgs, eq(groups.orgId, orgs.id))
        .where(and(eq(groups.id, req.params.id), eq(groups.orgId, req.params.orgId)))
        .limit(1);
      if (!row) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Group not found' } as never);
      }

      const [toOrg] = await app.db.select().from(orgs).where(eq(orgs.id, toOrgId)).limit(1);
      if (!toOrg) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Target org not found' } as never);
      }

      // Path slug must be free, and no device names may collide in the target org.
      const [slugClash] = await app.db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.orgId, toOrgId), eq(groups.pathSlug, row.group.pathSlug)))
        .limit(1);
      if (slugClash) {
        return reply
          .code(409)
          .send({
            statusCode: 409,
            error: 'Conflict',
            message: 'A group with this path slug exists in the target org',
          } as never);
      }
      const groupDevices = await app.db
        .select({ id: devices.id, name: devices.name })
        .from(devices)
        .where(eq(devices.groupId, req.params.id));
      const names = groupDevices.map((d) => d.name);
      if (names.length > 0) {
        const collisions = await app.db
          .select({ name: devices.name })
          .from(devices)
          .where(and(eq(devices.orgId, toOrgId), inArray(devices.name, names)));
        if (collisions.length > 0) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: `Device name(s) already exist in the target org: ${collisions.map((c) => c.name).join(', ')}`,
          } as never);
        }
      }

      for (const d of groupDevices) {
        await moveConfigAcrossRepos(app.config.reposDir, {
          fromOrgSlug: row.org.slug,
          toOrgSlug: toOrg.slug,
          fromGroupSlug: row.group.pathSlug,
          toGroupSlug: row.group.pathSlug,
          deviceName: d.name,
        });
      }

      await app.db
        .update(groups)
        .set({ orgId: toOrgId, defaultCredentialId: null })
        .where(eq(groups.id, req.params.id));
      if (names.length > 0) {
        await app.db
          .update(devices)
          .set({ orgId: toOrgId, credentialId: null, nextRunAt: new Date() })
          .where(eq(devices.groupId, req.params.id));
        await app.db
          .update(jobs)
          .set({ orgId: toOrgId })
          .where(
            inArray(
              jobs.deviceId,
              groupDevices.map((d) => d.id),
            ),
          );
      }

      return { ok: true, movedDevices: groupDevices.length };
    },
  );
};
