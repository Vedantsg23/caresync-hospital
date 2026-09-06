import '@/server/only';
import { cache } from 'react';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { sessions, users, staffProfiles, departments } from '@/server/db/schema';
import { readSessionCookie, verifySessionToken } from './session';
import { AppError } from '@/server/core/errors';
import { permissionsForRole, type Permission, type Role } from '@/types/rbac';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
  sessionTokenId: string;
  staffProfileId: string | null;
  staffNumber: string | null;
  designation: string | null;
  specialization: string | null;
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
  acceptsReferrals: boolean;
};

/**
 * Resolves the caller from the signed session cookie **and** confirms the
 * session row is still live. A stolen or replayed JWT is useless once the
 * session is revoked. Memoised per request by React `cache`.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const token = await readSessionCookie();
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.primaryRole,
      isActive: users.isActive,
      staffProfileId: staffProfiles.id,
      staffNumber: staffProfiles.staffNumber,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      acceptsReferrals: staffProfiles.acceptsReferrals,
      departmentId: departments.id,
      departmentName: departments.name,
      departmentCode: departments.code,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(and(eq(sessions.tokenId, claims.jti), isNull(sessions.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!row.isActive) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return {
    id: row.userId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as Role,
    permissions: permissionsForRole(row.role as Role),
    sessionTokenId: claims.jti,
    staffProfileId: row.staffProfileId,
    staffNumber: row.staffNumber,
    designation: row.designation,
    specialization: row.specialization,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    departmentCode: row.departmentCode,
    acceptsReferrals: row.acceptsReferrals ?? false,
  };
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError('UNAUTHENTICATED', 'You must be signed in to continue.');
  return user;
}

export function assertPermission(user: AuthUser, permission: Permission): void {
  if (!user.permissions.includes(permission)) {
    throw new AppError(
      'INSUFFICIENT_PERMISSION',
      `Your role (${user.role}) does not include the "${permission}" permission.`,
    );
  }
}

export async function requirePermission(permission: Permission): Promise<AuthUser> {
  const user = await requireUser();
  assertPermission(user, permission);
  return user;
}

export function hasPermission(user: AuthUser | null, permission: Permission): boolean {
  return !!user && user.permissions.includes(permission);
}
