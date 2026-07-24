import {
  credentialSchema,
  driverInfoSchema,
  groupSchema,
  upsertCredentialRequestSchema,
  upsertGroupRequestSchema,
} from '@fe2o3/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { encryptSecret } from '../auth/crypto.js';
import { requireOrgRole } from '../auth/plugin.js';
import { getOrgRepo } from '../core/git/repo.js';
import { credentials, devices, groups, orgs } from '../db/schema.js';
import { respond } from './replies.js';

const orgParams = z.object({ orgId: z.string() });
const orgIdParams = z.object({ orgId: z.string(), id: z.string() });

const credentialColumns = {
  id: credentials.id,
  orgId: credentials.orgId,
  name: credentials.name,
  username: credentials.username,
  hasPassword: sql<boolean>`(${credentials.passwordEnc} is not null)`,
  hasEnablePassword: sql<boolean>`(${credentials.enablePasswordEnc} is not null)`,
  hasSshKey: sql<boolean>`(${credentials.sshPrivateKeyEnc} is not null)`,
  createdAt: credentials.createdAt,
};

export const inventoryRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---- drivers ----
  app.get(
    '/models',
    { schema: { tags: ['models'], response: { 200: z.array(driverInfoSchema) } } },
    async () =>
      app.registry.list().map((d) => ({
        id: d.id,
        displayName: d.displayName,
        vars: (d.vars ?? []).map(({ key, description, type }) => ({ key, description, type })),
      })),
  );

  // ---- credentials ----
  app.get(
    '/orgs/:orgId/credentials',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['credentials'],
        params: orgParams,
        response: { 200: z.array(credentialSchema) },
      },
    },
    async (req) =>
      app.db
        .select(credentialColumns)
        .from(credentials)
        .where(eq(credentials.orgId, req.params.orgId)),
  );

  app.post(
    '/orgs/:orgId/credentials',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['credentials'],
        params: orgParams,
        body: upsertCredentialRequestSchema,
        response: { 200: credentialSchema },
      },
    },
    async (req) => {
      const { name, username, password, enablePassword, sshPrivateKey, sshKeyPassphrase } =
        req.body;
      const enc = (v: string | undefined) =>
        v === undefined || v === '' ? null : encryptSecret(v, app.config.keyring);
      const [created] = await app.db
        .insert(credentials)
        .values({
          orgId: req.params.orgId,
          name,
          username,
          passwordEnc: enc(password),
          enablePasswordEnc: enc(enablePassword),
          sshPrivateKeyEnc: enc(sshPrivateKey),
          sshKeyPassphraseEnc: enc(sshKeyPassphrase),
        })
        .returning({ id: credentials.id });
      const [row] = await app.db
        .select(credentialColumns)
        .from(credentials)
        .where(eq(credentials.id, created?.id ?? ''));
      return row;
    },
  );

  app.patch(
    '/orgs/:orgId/credentials/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['credentials'],
        params: orgIdParams,
        body: upsertCredentialRequestSchema.partial(),
        response: respond(credentialSchema, 404),
      },
    },
    async (req, reply) => {
      const patch: Record<string, unknown> = {};
      const b = req.body;
      const enc = (v: string) => (v === '' ? null : encryptSecret(v, app.config.keyring));
      if (b.name !== undefined) patch.name = b.name;
      if (b.username !== undefined) patch.username = b.username;
      if (b.password !== undefined) patch.passwordEnc = enc(b.password);
      if (b.enablePassword !== undefined) patch.enablePasswordEnc = enc(b.enablePassword);
      if (b.sshPrivateKey !== undefined) patch.sshPrivateKeyEnc = enc(b.sshPrivateKey);
      if (b.sshKeyPassphrase !== undefined) patch.sshKeyPassphraseEnc = enc(b.sshKeyPassphrase);
      const [updated] = await app.db
        .update(credentials)
        .set(patch)
        .where(and(eq(credentials.id, req.params.id), eq(credentials.orgId, req.params.orgId)))
        .returning({ id: credentials.id });
      if (!updated) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Credential not found' } as never);
      }
      const [row] = await app.db
        .select(credentialColumns)
        .from(credentials)
        .where(eq(credentials.id, updated.id));
      return row;
    },
  );

  app.delete(
    '/orgs/:orgId/credentials/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['credentials'],
        params: orgIdParams,
        response: respond(z.object({ ok: z.boolean() }), 409),
      },
    },
    async (req, reply) => {
      const inUse = await app.db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.credentialId, req.params.id))
        .limit(1);
      if (inUse.length > 0) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Credential is in use by devices',
        } as never);
      }
      await app.db
        .delete(credentials)
        .where(and(eq(credentials.id, req.params.id), eq(credentials.orgId, req.params.orgId)));
      return { ok: true };
    },
  );

  // ---- groups ----
  app.get(
    '/orgs/:orgId/groups',
    {
      preHandler: requireOrgRole('readonly'),
      schema: { tags: ['groups'], params: orgParams, response: { 200: z.array(groupSchema) } },
    },
    async (req) =>
      app.db
        .select({
          id: groups.id,
          orgId: groups.orgId,
          name: groups.name,
          pathSlug: groups.pathSlug,
          defaultCredentialId: groups.defaultCredentialId,
          defaultIntervalSec: groups.defaultIntervalSec,
          deviceCount: sql<number>`(select count(*)::int from ${devices} where ${devices.groupId} = ${groups.id})`,
        })
        .from(groups)
        .where(eq(groups.orgId, req.params.orgId)),
  );

  app.post(
    '/orgs/:orgId/groups',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['groups'],
        params: orgParams,
        body: upsertGroupRequestSchema,
        response: respond(groupSchema, 409),
      },
    },
    async (req, reply) => {
      const [existing] = await app.db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.orgId, req.params.orgId), eq(groups.pathSlug, req.body.pathSlug)))
        .limit(1);
      if (existing) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Path slug already in use',
        } as never);
      }
      const [group] = await app.db
        .insert(groups)
        .values({
          orgId: req.params.orgId,
          name: req.body.name,
          pathSlug: req.body.pathSlug,
          defaultCredentialId: req.body.defaultCredentialId ?? null,
          defaultIntervalSec: req.body.defaultIntervalSec,
        })
        .returning();
      return group;
    },
  );

  app.patch(
    '/orgs/:orgId/groups/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['groups'],
        params: orgIdParams,
        body: upsertGroupRequestSchema.partial(),
        response: respond(groupSchema, 404),
      },
    },
    async (req, reply) => {
      const [existing] = await app.db
        .select()
        .from(groups)
        .where(and(eq(groups.id, req.params.id), eq(groups.orgId, req.params.orgId)))
        .limit(1);
      if (!existing) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Group not found' } as never);
      }

      // A slug change moves every device file in git so history follows
      if (req.body.pathSlug !== undefined && req.body.pathSlug !== existing.pathSlug) {
        const [dupe] = await app.db
          .select({ id: groups.id })
          .from(groups)
          .where(and(eq(groups.orgId, req.params.orgId), eq(groups.pathSlug, req.body.pathSlug)))
          .limit(1);
        if (dupe) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Path slug already in use',
          } as never);
        }
        const [org] = await app.db
          .select({ slug: orgs.slug })
          .from(orgs)
          .where(eq(orgs.id, req.params.orgId))
          .limit(1);
        const groupDevices = await app.db
          .select({ name: devices.name })
          .from(devices)
          .where(eq(devices.groupId, req.params.id));
        if (org && groupDevices.length > 0) {
          const repo = await getOrgRepo(app.config.reposDir, org.slug);
          for (const d of groupDevices) {
            await repo.moveDevice({
              fromGroup: existing.pathSlug,
              fromName: d.name,
              toGroup: req.body.pathSlug,
              toName: d.name,
            });
          }
        }
      }

      const patch: Record<string, unknown> = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.pathSlug !== undefined) patch.pathSlug = req.body.pathSlug;
      if (req.body.defaultCredentialId !== undefined)
        patch.defaultCredentialId = req.body.defaultCredentialId;
      if (req.body.defaultIntervalSec !== undefined)
        patch.defaultIntervalSec = req.body.defaultIntervalSec;
      const [group] = await app.db
        .update(groups)
        .set(patch)
        .where(and(eq(groups.id, req.params.id), eq(groups.orgId, req.params.orgId)))
        .returning();
      if (!group) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Group not found' } as never);
      }
      return group;
    },
  );

  app.delete(
    '/orgs/:orgId/groups/:id',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['groups'],
        params: orgIdParams,
        response: respond(z.object({ ok: z.boolean() }), 409),
      },
    },
    async (req, reply) => {
      const inUse = await app.db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.groupId, req.params.id))
        .limit(1);
      if (inUse.length > 0) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Group still contains devices',
        } as never);
      }
      await app.db
        .delete(groups)
        .where(and(eq(groups.id, req.params.id), eq(groups.orgId, req.params.orgId)));
      return { ok: true };
    },
  );
};
