import type { OrgRole } from '@fe2o3/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { orgMemberships, sessions, users } from '../db/schema.js';
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
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const roleRank: Record<OrgRole, number> = { readonly: 0, operator: 1, admin: 2 };

export const authPlugin = fp(async (app) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
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
