import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { orgMemberships, orgs, sessions } from '../db/schema.js';
import { generateToken } from './crypto.js';
import { SESSION_COOKIE, SESSION_TTL_MS } from './plugin.js';

export async function createSession(
  db: Db,
  reply: FastifyReply,
  opts: {
    userId: string;
    mfaPending: boolean;
    ip?: string | undefined;
    userAgent?: string | undefined;
  },
) {
  const { token, hash } = generateToken();
  const [session] = await db
    .insert(sessions)
    .values({
      tokenHash: hash,
      userId: opts.userId,
      mfaPending: opts.mfaPending,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    })
    .returning({ id: sessions.id });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return session;
}

export async function destroySession(db: Db, reply: FastifyReply, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function orgsForUser(db: Db, userId: string) {
  return db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      role: orgMemberships.role,
    })
    .from(orgMemberships)
    .innerJoin(orgs, eq(orgMemberships.orgId, orgs.id))
    .where(eq(orgMemberships.userId, userId));
}
