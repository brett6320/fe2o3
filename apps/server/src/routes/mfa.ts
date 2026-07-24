import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { toDataURL } from 'qrcode';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import { requireAuth } from '../auth/plugin.js';
import { createSession, orgsForUser } from '../auth/service.js';
import { sessions, users, webauthnCredentials } from '../db/schema.js';
import { respond } from './replies.js';

const okSchema = z.object({ ok: z.boolean() });

/** Short-lived WebAuthn challenges; single-process, so in-memory is fine. */
const challenges = new Map<string, { challenge: string; expires: number }>();
function putChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expires: Date.now() + 5 * 60_000 });
}
function takeChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

function rpConfig(baseUrl: string) {
  const url = new URL(baseUrl);
  return { rpID: url.hostname, origin: url.origin, rpName: 'fe2o3' };
}

export const mfaRoutes: FastifyPluginAsyncZod = async (app) => {
  const baseUrl = process.env.FE2O3_BASE_URL ?? 'http://localhost:8442';

  // ---------- TOTP ----------
  app.post(
    '/profile/totp/enroll',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['mfa'],
        response: { 200: z.object({ otpauthUrl: z.string(), qrDataUrl: z.string() }) },
      },
    },
    async (req) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      const secret = generateSecret();
      await app.db
        .update(users)
        .set({ totpSecretEnc: encryptSecret(secret, app.config.secretKey), totpEnabled: false })
        .where(eq(users.id, auth.userId));
      const otpauthUrl = generateURI({ issuer: 'fe2o3', label: auth.email, secret });
      return { otpauthUrl, qrDataUrl: await toDataURL(otpauthUrl) };
    },
  );

  app.post(
    '/profile/totp/confirm',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['mfa'],
        body: z.object({ code: z.string().min(6).max(8) }),
        response: respond(okSchema, 400),
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      const [user] = await app.db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
      if (!user?.totpSecretEnc) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No pending enrollment',
        } as never);
      }
      const secret = decryptSecret(user.totpSecretEnc, app.config.secretKey);
      if (!verifySync({ secret, token: req.body.code, epochTolerance: 1 }).valid) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Invalid code' } as never);
      }
      await app.db.update(users).set({ totpEnabled: true }).where(eq(users.id, auth.userId));
      return { ok: true };
    },
  );

  app.post(
    '/profile/totp/disable',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['mfa'],
        body: z.object({ code: z.string().min(6).max(8) }),
        response: respond(okSchema, 400),
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      const [user] = await app.db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
      if (!user?.totpSecretEnc || !user.totpEnabled) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'TOTP not enabled' } as never);
      }
      const secret = decryptSecret(user.totpSecretEnc, app.config.secretKey);
      if (!verifySync({ secret, token: req.body.code, epochTolerance: 1 }).valid) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Invalid code' } as never);
      }
      await app.db
        .update(users)
        .set({ totpEnabled: false, totpSecretEnc: null })
        .where(eq(users.id, auth.userId));
      return { ok: true };
    },
  );

  /** Step-up: completes an mfa_pending session. */
  app.post(
    '/auth/mfa/totp',
    {
      schema: {
        tags: ['mfa'],
        body: z.object({ code: z.string().min(6).max(8) }),
        response: respond(okSchema, 400, 401),
      },
    },
    async (req, reply) => {
      if (!req.auth) {
        return reply
          .code(401)
          .send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' } as never);
      }
      const [user] = await app.db
        .select()
        .from(users)
        .where(eq(users.id, req.auth.userId))
        .limit(1);
      if (!user?.totpSecretEnc) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'TOTP not enrolled' } as never);
      }
      const secret = decryptSecret(user.totpSecretEnc, app.config.secretKey);
      if (!verifySync({ secret, token: req.body.code, epochTolerance: 1 }).valid) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Invalid code' } as never);
      }
      await app.db
        .update(sessions)
        .set({ mfaPending: false })
        .where(eq(sessions.id, req.auth.sessionId));
      return { ok: true };
    },
  );

  // ---------- Passkeys (WebAuthn) ----------
  app.get(
    '/profile/passkeys',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['mfa'],
        response: {
          200: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.coerce.date() })),
        },
      },
    },
    async (req) =>
      app.db
        .select({
          id: webauthnCredentials.id,
          name: webauthnCredentials.name,
          createdAt: webauthnCredentials.createdAt,
        })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, req.auth?.userId ?? '')),
  );

  app.post(
    '/profile/passkeys/options',
    { preHandler: requireAuth, schema: { tags: ['mfa'], response: { 200: z.any() } } },
    async (req) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      const { rpID, rpName } = rpConfig(baseUrl);
      const existing = await app.db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, auth.userId));
      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: auth.email,
        userDisplayName: auth.displayName || auth.email,
        attestationType: 'none',
        excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      });
      putChallenge(`reg:${auth.userId}`, options.challenge);
      return options;
    },
  );

  app.post(
    '/profile/passkeys/verify',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['mfa'],
        body: z.object({ name: z.string().max(64).default('Passkey'), response: z.any() }),
        response: respond(okSchema, 400),
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      const challenge = takeChallenge(`reg:${auth.userId}`);
      if (!challenge) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Challenge expired' } as never);
      }
      const { rpID, origin } = rpConfig(baseUrl);
      const verification = await verifyRegistrationResponse({
        response: req.body.response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Verification failed' } as never);
      }
      const { credential } = verification.registrationInfo;
      await app.db.insert(webauthnCredentials).values({
        userId: auth.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports ?? [],
        name: req.body.name,
      });
      return { ok: true };
    },
  );

  app.delete(
    '/profile/passkeys/:id',
    {
      preHandler: requireAuth,
      schema: { tags: ['mfa'], params: z.object({ id: z.string() }), response: { 200: okSchema } },
    },
    async (req) => {
      const auth = req.auth;
      if (!auth) throw new Error('unreachable');
      await app.db
        .delete(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.id, req.params.id),
            eq(webauthnCredentials.userId, auth.userId),
          ),
        );
      return { ok: true };
    },
  );

  /** Usernameless passkey login. */
  app.post(
    '/auth/webauthn/options',
    { schema: { tags: ['mfa'], response: { 200: z.any() } } },
    async () => {
      const { rpID } = rpConfig(baseUrl);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'preferred',
      });
      putChallenge(`login:${options.challenge}`, options.challenge);
      return options;
    },
  );

  app.post(
    '/auth/webauthn/verify',
    {
      schema: {
        tags: ['mfa'],
        body: z.object({ response: z.any() }),
        response: respond(z.object({ ok: z.boolean() }), 400, 401),
      },
    },
    async (req, reply) => {
      const response = req.body.response as AuthenticationResponseJSON;
      const clientData = JSON.parse(
        Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
      ) as { challenge: string };
      const challenge = takeChallenge(`login:${clientData.challenge}`);
      if (!challenge) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Challenge expired' } as never);
      }
      const [cred] = await app.db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.credentialId, response.id))
        .limit(1);
      if (!cred) {
        return reply
          .code(401)
          .send({ statusCode: 401, error: 'Unauthorized', message: 'Unknown credential' } as never);
      }
      const { rpID, origin } = rpConfig(baseUrl);
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: cred.credentialId,
          publicKey: Buffer.from(cred.publicKey, 'base64url'),
          counter: cred.counter,
          transports: cred.transports as never,
        },
      });
      if (!verification.verified) {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Verification failed',
        } as never);
      }
      const [user] = await app.db.select().from(users).where(eq(users.id, cred.userId)).limit(1);
      if (!user || user.disabled) {
        return reply
          .code(401)
          .send({ statusCode: 401, error: 'Unauthorized', message: 'Account disabled' } as never);
      }
      await app.db
        .update(webauthnCredentials)
        .set({ counter: verification.authenticationInfo.newCounter })
        .where(eq(webauthnCredentials.id, cred.id));
      // Passkey satisfies MFA by itself — no step-up needed
      await createSession(app.db, reply, {
        userId: user.id,
        mfaPending: false,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      await orgsForUser(app.db, user.id);
      return { ok: true };
    },
  );
};
