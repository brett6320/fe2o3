import {
  createOrgRequestSchema,
  membershipSchema,
  orgSchema,
  upsertMembershipRequestSchema,
} from '@fe2o3/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrgRole, requireSuperadmin } from '../auth/plugin.js';
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
};
