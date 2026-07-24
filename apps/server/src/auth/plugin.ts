import type { OrgRole } from '@fe2o3/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { apiKeys, auditLog, orgMemberships, sessions, users } from '../db/schema.js';
import { sha256 } from './crypto.js';

export const SESSION_COOKIE = 'fe2o3_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  isSuperadmin: boolean;
  totpEnabled: boolean;
  sessionId: string;
  mfaPending: boolean;
  /** Set when authenticated via API key; used for scope enforcement. */
  apiKey?: { id: string; scope: 'read' | 'write' | 'admin' };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const roleRank: Record<OrgRole, number> = { readonly: 0, operator: 1, admin: 2 };

export const authPlugin = fp(async (app) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req, reply) => {
    // API key: Authorization: Bearer fe2o3_<prefix>_<secret>
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer fe2o3_')) {
      // format: fe2o3_<prefix>_<secret>; the secret is base64url and may itself contain '_'
      const rest = header.slice('Bearer fe2o3_'.length);
      const sep = rest.indexOf('_');
      const secret = sep >= 0 ? rest.slice(sep + 1) : undefined;
      if (secret) {
        const [key] = await app.db
          .select({
            id: apiKeys.id,
            scope: apiKeys.scope,
            expiresAt: apiKeys.expiresAt,
            userId: users.id,
            email: users.email,
            displayName: users.displayName,
            isSuperadmin: users.isSuperadmin,
            totpEnabled: users.totpEnabled,
            disabled: users.disabled,
          })
          .from(apiKeys)
          .innerJoin(users, eq(apiKeys.userId, users.id))
          .where(eq(apiKeys.tokenHash, sha256(secret)))
          .limit(1);
        if (key && !key.disabled && (!key.expiresAt || key.expiresAt > new Date())) {
          if (key.scope === 'read' && req.method !== 'GET' && req.method !== 'HEAD') {
            return reply.code(403).send({
              statusCode: 403,
              error: 'Forbidden',
              message: 'API key scope does not allow writes',
            });
          }
          req.auth = {
            userId: key.userId,
            email: key.email,
            displayName: key.displayName,
            isSuperadmin: key.isSuperadmin && key.scope === 'admin',
            totpEnabled: key.totpEnabled,
            sessionId: '',
            mfaPending: false,
            apiKey: { id: key.id, scope: key.scope },
          };
          void app.db
            .update(apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiKeys.id, key.id))
            .then(
              () => {},
              () => {},
            );
        }
      }
      return;
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await app.db
      .select({
        sessionId: sessions.id,
        mfaPending: sessions.mfaPending,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        isSuperadmin: users.isSuperadmin,
        totpEnabled: users.totpEnabled,
        disabled: users.disabled,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row || row.disabled) return;
    req.auth = {
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      isSuperadmin: row.isSuperadmin,
      totpEnabled: row.totpEnabled,
      sessionId: row.sessionId,
      mfaPending: row.mfaPending,
    };
  });

  // Audit every authenticated mutating API call
  app.addHook('onResponse', async (req, reply) => {
    if (!req.auth || req.method === 'GET' || req.method === 'HEAD') return;
    if (!req.url.startsWith('/api/')) return;
    if (reply.statusCode >= 400) return;
    try {
      await app.db.insert(auditLog).values({
        userId: req.auth.userId,
        apiKeyId: req.auth.apiKey?.id ?? null,
        action: req.method,
        resource: req.url.split('?')[0] ?? req.url,
        detail: {},
        ip: req.ip,
      });
    } catch (err) {
      req.log.warn({ err }, 'audit log write failed');
    }
  });
});

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) {
    return reply
      .code(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' });
  }
  if (req.auth.mfaPending) {
    return reply
      .code(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'MFA verification required' });
  }
}

export async function requireSuperadmin(req: FastifyRequest, reply: FastifyReply) {
  const failed = await requireAuth(req, reply);
  if (failed !== undefined) return failed;
  if (!req.auth?.isSuperadmin) {
    return reply
      .code(403)
      .send({ statusCode: 403, error: 'Forbidden', message: 'Superadmin required' });
  }
}

/**
 * Guard factory for org-scoped routes (`/orgs/:orgId/...`). Superadmins pass
 * implicitly; everyone else needs a membership with at least `minRole`.
 */
export function requireOrgRole(minRole: OrgRole) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const failed = await requireAuth(req, reply);
    if (failed !== undefined) return failed;
    const auth = req.auth;
    if (auth === null) return;
    if (auth.isSuperadmin) return;
    const { orgId } = req.params as { orgId: string };
    const db = (req.server as { db: import('../db/index.js').Db }).db;
    const [m] = await db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, auth.userId)))
      .limit(1);
    if (!m || roleRank[m.role] < roleRank[minRole]) {
      return reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Insufficient role for this organization',
      });
    }
  };
}
