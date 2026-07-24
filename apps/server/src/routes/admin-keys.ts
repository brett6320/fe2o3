import { eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { blobKeyId, decryptSecret, encryptSecret } from '../auth/crypto.js';
import { addActiveKey, removeKey } from '../auth/keyring.js';
import { requireSuperadmin } from '../auth/plugin.js';
import { credentials, devices, users } from '../db/schema.js';
import { respond } from './replies.js';

/**
 * Symmetric key rotation (superadmin).
 *
 * Rotation order is crash-safe: the new key is persisted to the keyring file
 * BEFORE any data is re-encrypted, and every blob names the key that sealed it,
 * so an interruption at any point leaves all data decryptable.
 */
export const adminKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/admin/keys',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['admin'],
        response: {
          200: z.object({ activeKeyId: z.string(), keyIds: z.array(z.string()) }),
        },
      },
    },
    async () => ({
      activeKeyId: app.config.keyring.activeId,
      keyIds: [...app.config.keyring.keys.keys()],
    }),
  );

  app.post(
    '/admin/keys/rotate',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['admin'],
        response: {
          200: z.object({
            activeKeyId: z.string(),
            rotated: z.object({
              credentialSecrets: z.number(),
              totpSecrets: z.number(),
              deviceVars: z.number(),
            }),
          }),
        },
      },
    },
    async () => {
      const keyring = app.config.keyring;
      // 1. Persist the new key first — see plugin doc comment.
      const newId = addActiveKey(app.config.dataDir, keyring);
      const reseal = (blob: string) =>
        blobKeyId(blob) === newId ? blob : encryptSecret(decryptSecret(blob, keyring), keyring);

      // 2. Re-encrypt everything under the new key.
      const rotated = { credentialSecrets: 0, totpSecrets: 0, deviceVars: 0 };

      const credRows = await app.db.select().from(credentials);
      for (const c of credRows) {
        const patch: Record<string, string> = {};
        for (const col of [
          'passwordEnc',
          'enablePasswordEnc',
          'sshPrivateKeyEnc',
          'sshKeyPassphraseEnc',
        ] as const) {
          const blob = c[col];
          if (blob) {
            patch[col] = reseal(blob);
            rotated.credentialSecrets++;
          }
        }
        if (Object.keys(patch).length > 0) {
          await app.db.update(credentials).set(patch).where(eq(credentials.id, c.id));
        }
      }

      const userRows = await app.db.select().from(users).where(isNotNull(users.totpSecretEnc));
      for (const u of userRows) {
        if (!u.totpSecretEnc) continue;
        await app.db
          .update(users)
          .set({ totpSecretEnc: reseal(u.totpSecretEnc) })
          .where(eq(users.id, u.id));
        rotated.totpSecrets++;
      }

      const deviceRows = await app.db
        .select()
        .from(devices)
        .where(sql`${devices.vars} ? 'enablePasswordEnc'`);
      for (const d of deviceRows) {
        const enc = d.vars.enablePasswordEnc;
        if (typeof enc !== 'string') continue;
        await app.db
          .update(devices)
          .set({ vars: { ...d.vars, enablePasswordEnc: reseal(enc) } })
          .where(eq(devices.id, d.id));
        rotated.deviceVars++;
      }

      app.log.info({ newKeyId: newId, rotated }, 'secret key rotated');
      return { activeKeyId: newId, rotated };
    },
  );

  app.delete(
    '/admin/keys/:id',
    {
      preHandler: requireSuperadmin,
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string() }),
        response: respond(z.object({ ok: z.boolean() }), 400, 404),
      },
    },
    async (req, reply) => {
      const keyring = app.config.keyring;
      if (req.params.id === keyring.activeId) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Cannot remove the active key',
        } as never);
      }
      if (!keyring.keys.has(req.params.id)) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Unknown key id' } as never);
      }
      removeKey(app.config.dataDir, keyring, req.params.id);
      return { ok: true };
    },
  );
};
