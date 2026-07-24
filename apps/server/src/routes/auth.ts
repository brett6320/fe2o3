import { loginRequestSchema, sessionUserSchema } from '@fe2o3/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { verifyPassword } from '../auth/crypto.js';
import { createSession, destroySession, orgsForUser } from '../auth/service.js';
import { users } from '../db/schema.js';
import { respond } from './replies.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        body: loginRequestSchema,
        response: respond(sessionUserSchema, 401),
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = user && !user.disabled && (await verifyPassword(user.passwordHash, password));
      if (!ok || !user) {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid credentials',
        } as never);
      }
      // Passkey-less MFA today: TOTP-enrolled users get a step-up session (M5 completes this).
      const mfaPending = user.totpEnabled;
      await createSession(app.db, reply, {
        userId: user.id,
        mfaPending,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isSuperadmin: user.isSuperadmin,
        totpEnabled: user.totpEnabled,
        mfaPending,
        orgs: await orgsForUser(app.db, user.id),
      };
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req, reply) => {
      if (req.auth) await destroySession(app.db, reply, req.auth.sessionId);
      return { ok: true };
    },
  );

  app.get(
    '/auth/session',
    { schema: { tags: ['auth'], response: respond(sessionUserSchema, 401) } },
    async (req, reply) => {
      if (!req.auth) {
        return reply
          .code(401)
          .send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' } as never);
      }
      return {
        id: req.auth.userId,
        email: req.auth.email,
        displayName: req.auth.displayName,
        isSuperadmin: req.auth.isSuperadmin,
        totpEnabled: req.auth.totpEnabled,
        mfaPending: req.auth.mfaPending,
        orgs: await orgsForUser(app.db, req.auth.userId),
      };
    },
  );
};
