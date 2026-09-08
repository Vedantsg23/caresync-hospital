import '@/server/only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { sessions } from '@/server/db/schema';
import { getEnv } from '@/lib/env';
import type { Role } from '@/types/rbac';

export const SESSION_COOKIE = 'caresync_session';
const ISSUER = 'caresync-hospital';

export type SessionClaims = { sub: string; jti: string; role: Role; email: string };

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

export async function issueSession(params: {
  userId: string;
  role: Role;
  email: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Carried across a rotation so the absolute ceiling is not reset by renewal. */
  absoluteExpiresAt?: Date;
  /** The session this one replaces, so rotation is traceable in the table. */
  rotatedFromId?: string | null;
}): Promise<{ token: string; expiresAt: Date; tokenId: string }> {
  const env = getEnv();
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE * 1000);

  await db.insert(sessions).values({
    userId: params.userId,
    tokenId,
    userAgent: params.userAgent ?? null,
    ipAddress: params.ipAddress ?? null,
    expiresAt,
    // Renewal extends a session but cannot extend it forever. After the
    // absolute window the holder signs in again, whatever they have been doing.
    absoluteExpiresAt: params.absoluteExpiresAt
      ?? new Date(Date.now() + env.SESSION_ABSOLUTE_MAX_AGE * 1000),
    rotatedFromId: params.rotatedFromId ?? null,
  });

  const token = await new SignJWT({ role: params.role, email: params.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.userId)
    .setJti(tokenId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());

  return { token, expiresAt, tokenId };
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER });
    if (!payload.sub || !payload.jti) return null;
    return {
      sub: payload.sub,
      jti: payload.jti,
      role: payload.role as Role,
      email: (payload.email as string) ?? '',
    };
  } catch {
    return null;
  }
}

export async function revokeSession(tokenId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenId, tokenId));
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
}

/**
 * Renew a session by replacing it.
 *
 * A long-lived cookie that never changes is a long-lived credential: steal it
 * once and you hold it until it expires. Rotation issues a fresh token, revokes
 * the old one in the same transaction, and refuses to extend past the absolute
 * ceiling recorded when the session began — so an attacker who captures a token
 * inherits a shrinking window rather than an indefinite one.
 */
export async function rotateSession(params: {
  currentTokenId: string;
  userId: string;
  role: Role;
  email: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ token: string; expiresAt: Date; tokenId: string } | null> {
  const [current] = await db
    .select({
      id: sessions.id,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
    })
    .from(sessions)
    .where(and(
      eq(sessions.tokenId, params.currentTokenId),
      isNull(sessions.revokedAt),
      sql`${sessions.expiresAt} > now()`,
    ))
    .limit(1);

  if (!current) return null;

  const ceiling = current.absoluteExpiresAt;
  if (ceiling && ceiling.getTime() <= Date.now()) {
    // The absolute window has closed. Renewal is over; sign in again.
    await revokeSession(params.currentTokenId);
    return null;
  }

  const issued = await issueSession({
    userId: params.userId,
    role: params.role,
    email: params.email,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    absoluteExpiresAt: ceiling ?? undefined,
    rotatedFromId: current.id,
  });

  // The old token dies the moment the new one exists, so the two never overlap.
  await revokeSession(params.currentTokenId);

  // Never let renewal push a session past its ceiling.
  if (ceiling && issued.expiresAt.getTime() > ceiling.getTime()) {
    await db.update(sessions).set({ expiresAt: ceiling }).where(eq(sessions.tokenId, issued.tokenId));
    return { ...issued, expiresAt: ceiling };
  }
  return issued;
}

/** Records activity, so an idle session can be distinguished from a live one. */
export async function touchSession(tokenId: string): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.tokenId, tokenId));
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}
