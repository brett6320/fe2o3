import { sessionUserSchema, setupRequestSchema, setupStatusSchema } from '@fe2o3/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { hashPassword } from '../auth/crypto.js';
import { createSession, orgsForUser } from '../auth/service.js';
import { orgMemberships, orgs, users } from '../db/schema.js';
import { respond } from './replies.js';

export const setupRoutes: FastifyPluginAsyncZod = async (app) => {
  const needsSetup = async () => {
    const [row] = await app.db.select({ count: sql<number>`count(*)::int` }).from(users);
    return (row?.count ?? 0) === 0;
  };

  app.get(
    '/setup/status',
    { schema: { tags: ['setup'], response: { 200: setupStatusSchema } } },
    async () => ({ needsSetup: await needsSetup() }),
  );

  app.post(
    '/setup',
    {
      schema: {
        tags: ['setup'],
        body: setupRequestSchema,
        response: respond(sessionUserSchema, 409),
      },
    },
    async (req, reply) => {
      if (!(await needsSetup())) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Setup already completed',
        } as never);
      }
      const { email, password, displayName, orgName, orgSlug } = req.body;
      const [user] = await app.db
        .insert(users)
        .values({
          email,
          displayName,
          passwordHash: await hashPassword(password),
          isSuperadmin: true,
        })
        .returning();
      if (!user) throw new Error('failed to create user');
      const [org] = await app.db.insert(orgs).values({ name: orgName, slug: orgSlug }).returning();
      if (!org) throw new Error('failed to create org');
      await app.db.insert(orgMemberships).values({ orgId: org.id, userId: user.id, role: 'admin' });
      await createSession(app.db, reply, {
        userId: user.id,
        mfaPending: false,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isSuperadmin: true,
        totpEnabled: false,
        mfaPending: false,
        orgs: await orgsForUser(app.db, user.id),
      };
    },
  );
};
