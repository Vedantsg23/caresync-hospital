import '@/server/only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
