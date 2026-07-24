import {
  createOrgRequestSchema,
  membershipSchema,
  orgSchema,
  upsertMembershipRequestSchema,
} from '@fe2o3/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import { requireOrgRole, requireSuperadmin } from '../auth/plugin.js';
import { getOrgRepo } from '../core/git/repo.js';
import { orgMemberships, orgs, users } from '../db/schema.js';
import { respond } from './replies.js';

export const orgRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/orgs',
    {
      preHandler: requireSuperadmin,
      schema: { tags: ['orgs'], response: { 200: z.array(orgSchema) } },
    },
    async () => app.db.select().from(orgs),
  );

  app.post(
    '/orgs',
    {
      preHandler: requireSuperadmin,
      schema: { tags: ['orgs'], body: createOrgRequestSchema, response: respond(orgSchema, 409) },
    },
    async (req, reply) => {
      const [existing] = await app.db
        .select()
        .from(orgs)
        .where(eq(orgs.slug, req.body.slug))
        .limit(1);
      if (existing) {
        return reply
          .code(409)
          .send({ statusCode: 409, error: 'Conflict', message: 'Slug already in use' } as never);
      }
      const [org] = await app.db.insert(orgs).values(req.body).returning();
      return org;
    },
  );

  app.delete(
    '/orgs/:orgId',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await app.db.delete(orgs).where(eq(orgs.id, req.params.orgId));
      return { ok: true };
    },
  );

  app.get(
    '/orgs/:orgId/members',
    {
      preHandler: requireOrgRole('readonly'),
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string() }),
        response: { 200: z.array(membershipSchema) },
      },
    },
    async (req) =>
      app.db
        .select({
          id: orgMemberships.id,
          orgId: orgMemberships.orgId,
          userId: orgMemberships.userId,
          role: orgMemberships.role,
          email: users.email,
          displayName: users.displayName,
        })
        .from(orgMemberships)
        .innerJoin(users, eq(orgMemberships.userId, users.id))
        .where(eq(orgMemberships.orgId, req.params.orgId)),
  );

  app.put(
    '/orgs/:orgId/members',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string() }),
        body: upsertMembershipRequestSchema,
        response: respond(z.object({ ok: z.boolean() }), 404),
      },
    },
    async (req, reply) => {
      const { userId, role } = req.body;
      const [user] = await app.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'User not found' } as never);
      }
      await app.db
        .insert(orgMemberships)
        .values({ orgId: req.params.orgId, userId, role })
        .onConflictDoUpdate({
          target: [orgMemberships.orgId, orgMemberships.userId],
          set: { role },
        });
      return { ok: true };
    },
  );

  app.delete(
    '/orgs/:orgId/members/:userId',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string(), userId: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await app.db
        .delete(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, req.params.orgId),
            eq(orgMemberships.userId, req.params.userId),
          ),
        );
      return { ok: true };
    },
  );
  // ---- external git mirror (one per org) ----
  const mirrorSchema = z.object({
    mirrorUrl: z.string().nullable(),
    mirrorBranch: z.string(),
    hasToken: z.boolean(),
    hasSshKey: z.boolean(),
  });

  app.get(
    '/orgs/:orgId/mirror',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string() }),
        response: respond(mirrorSchema, 404),
      },
    },
    async (req, reply) => {
      const [org] = await app.db.select().from(orgs).where(eq(orgs.id, req.params.orgId)).limit(1);
      if (!org) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Org not found' } as never);
      }
      return {
        mirrorUrl: org.mirrorUrl,
        mirrorBranch: org.mirrorBranch,
        hasToken: org.mirrorTokenEnc !== null,
        hasSshKey: org.mirrorSshKeyEnc !== null,
      };
    },
  );

  app.put(
    '/orgs/:orgId/mirror',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string() }),
        body: z.object({
          mirrorUrl: z.string().max(1024).nullable(),
          mirrorBranch: z.string().min(1).max(200).default('main'),
          // write-only secrets: omit to keep, empty string to clear
          token: z.string().max(4096).optional(),
          sshKey: z.string().max(32768).optional(),
        }),
        response: { 200: mirrorSchema },
      },
    },
    async (req) => {
      const enc = (v: string | undefined) =>
        v === undefined ? undefined : v === '' ? null : encryptSecret(v, app.config.keyring);
      const patch: Record<string, unknown> = {
        mirrorUrl: req.body.mirrorUrl,
        mirrorBranch: req.body.mirrorBranch,
      };
      const t = enc(req.body.token);
      if (t !== undefined) patch.mirrorTokenEnc = t;
      const k = enc(req.body.sshKey);
      if (k !== undefined) patch.mirrorSshKeyEnc = k;
      const [org] = await app.db
        .update(orgs)
        .set(patch)
        .where(eq(orgs.id, req.params.orgId))
        .returning();
      return {
        mirrorUrl: org?.mirrorUrl ?? null,
        mirrorBranch: org?.mirrorBranch ?? 'main',
        hasToken: (org?.mirrorTokenEnc ?? null) !== null,
        hasSshKey: (org?.mirrorSshKeyEnc ?? null) !== null,
      };
    },
  );

  app.post(
    '/orgs/:orgId/mirror/test',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['orgs'],
        params: z.object({ orgId: z.string() }),
        response: respond(z.object({ ok: z.boolean(), error: z.string().optional() }), 400),
      },
    },
    async (req, reply) => {
      const [org] = await app.db.select().from(orgs).where(eq(orgs.id, req.params.orgId)).limit(1);
      if (!org?.mirrorUrl) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No mirror URL configured',
        } as never);
      }
      const dec = (v: string | null) => (v ? decryptSecret(v, app.config.keyring) : undefined);
      const repo = await getOrgRepo(app.config.reposDir, org.slug);
      try {
        await repo.mirror({
          url: org.mirrorUrl,
          branch: org.mirrorBranch,
          token: dec(org.mirrorTokenEnc),
          sshKey: dec(org.mirrorSshKeyEnc),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : String(err) };
      }
    },
  );
};
