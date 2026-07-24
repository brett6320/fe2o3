import {
  changePasswordRequestSchema,
  createUserRequestSchema,
  updateUserRequestSchema,
  userSchema,
} from '@fe2o3/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/crypto.js';
import { requireAuth, requireSuperadmin } from '../auth/plugin.js';
import { sessions, users } from '../db/schema.js';
import { respond } from './replies.js';

const publicUser = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isSuperadmin: users.isSuperadmin,
  disabled: users.disabled,
  totpEnabled: users.totpEnabled,
  createdAt: users.createdAt,
};

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/users',
    {
      preHandler: requireSuperadmin,
      schema: { tags: ['users'], response: { 200: z.array(userSchema) } },
    },
    async () => app.db.select(publicUser).from(users),
  );

  app.post(
    '/users',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['users'],
        body: createUserRequestSchema,
        response: respond(userSchema, 409),
      },
    },
    async (req, reply) => {
      const { email, password, displayName, isSuperadmin } = req.body;
      const [existing] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existing) {
        return reply
          .code(409)
          .send({ statusCode: 409, error: 'Conflict', message: 'Email already in use' } as never);
      }
      const [user] = await app.db
        .insert(users)
        .values({ email, displayName, passwordHash: await hashPassword(password), isSuperadmin })
        .returning(publicUser);
      return user;
    },
  );

  app.patch(
    '/users/:id',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['users'],
        params: z.object({ id: z.string() }),
        body: updateUserRequestSchema,
        response: respond(userSchema, 404),
      },
    },
    async (req, reply) => {
      const patch: Record<string, unknown> = {};
      if (req.body.displayName !== undefined) patch.displayName = req.body.displayName;
      if (req.body.isSuperadmin !== undefined) patch.isSuperadmin = req.body.isSuperadmin;
      if (req.body.disabled !== undefined) patch.disabled = req.body.disabled;
      if (req.body.password !== undefined)
        patch.passwordHash = await hashPassword(req.body.password);
      const [user] = await app.db
        .update(users)
        .set(patch)
        .where(eq(users.id, req.params.id))
        .returning(publicUser);
      if (!user) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'User not found' } as never);
      }
      if (req.body.disabled === true || req.body.password !== undefined) {
        await app.db.delete(sessions).where(eq(sessions.userId, user.id));
      }
      return user;
    },
  );

  app.delete(
    '/users/:id',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['users'],
        params: z.object({ id: z.string() }),
        response: respond(z.object({ ok: z.boolean() }), 400),
      },
    },
    async (req, reply) => {
      if (req.auth?.userId === req.params.id) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Cannot delete yourself',
        } as never);
      }
      await app.db.delete(users).where(eq(users.id, req.params.id));
      return { ok: true };
    },
  );

  app.post(
    '/profile/password',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['profile'],
        body: changePasswordRequestSchema,
        response: respond(z.object({ ok: z.boolean() }), 400),
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      if (!auth) return;
      const [user] = await app.db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
      if (!user || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Current password incorrect',
        } as never);
      }
      await app.db
        .update(users)
        .set({ passwordHash: await hashPassword(req.body.newPassword) })
        .where(eq(users.id, auth.userId));
      return { ok: true };
    },
  );
};
