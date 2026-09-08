import '@/server/only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { users, staffProfiles, departments } from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { verifyPassword, hashPassword, passwordIssues } from '@/server/auth/password';
import { issueSession, revokeSession, revokeAllSessionsForUser } from '@/server/auth/session';
import { recordAudit, AUDIT } from '@/server/core/audit';
import { permissionsForRole, ROLE_HOME, type Role } from '@/types/rbac';
import type { AuthUser } from '@/server/auth/context';

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export type LoginResult = {
  user: {
    id: string; email: string; fullName: string; role: Role;
    permissions: string[]; departmentId: string | null; departmentName: string | null;
    designation: string | null; specialization: string | null; staffNumber: string | null;
  };
  redirectTo: string;
  /** The caller (a route handler) is responsible for setting the cookie. */
  session: { token: string; expiresAt: Date };
};

/**
 * Password login.
 *
 * Failure is deliberately indistinguishable between "no such account", "wrong
 * password" and "deactivated account" so the endpoint cannot be used to
 * enumerate hospital staff. Repeated failures lock the account temporarily.
 */
export async function login(
  input: { email: string; password: string },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      fullName: users.fullName,
      role: users.primaryRole,
      isActive: users.isActive,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      failedLogins: users.failedLogins,
      lockedUntil: users.lockedUntil,
      staffNumber: staffProfiles.staffNumber,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      departmentId: departments.id,
      departmentName: departments.name,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(eq(users.email, email))
    .limit(1);

  const genericFailure = () =>
    new AppError('INVALID_CREDENTIALS', 'The email address or password is incorrect.');

  if (!row) {
    // Constant-ish work factor so a missing account is not measurably faster.
    await verifyPassword(input.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu');
    await recordAudit({
      action: AUDIT.LOGIN_FAILED, entityType: 'user', outcome: 'FAILURE',
      metadata: { email, reason: 'NO_SUCH_USER' },
      ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    throw genericFailure();
  }

  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError('ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const valid = await verifyPassword(input.password, row.passwordHash);

  /**
   * A correct password is necessary but not sufficient. An account must also
   * have finished the registration path: address verified, and an administrator
   * having granted it a role. These states get their own messages because
   * telling someone "your account is awaiting approval" is useful and leaks
   * nothing they did not already know — they registered it themselves. The
   * check runs only after the password verifies, so it cannot be used to probe
   * for the existence or state of an account you do not hold the password to.
   */
  if (valid) {
    if (row.status === 'PENDING_VERIFICATION' || !row.emailVerifiedAt) {
      await recordAudit({
        action: AUDIT.LOGIN_BLOCKED, entityType: 'user', entityId: row.id, outcome: 'DENIED',
        actor: { id: row.id, email: row.email, role: row.role as Role },
        metadata: { reason: 'EMAIL_NOT_VERIFIED' },
        ipAddress: context.ipAddress, userAgent: context.userAgent,
      });
      throw new AppError(
        'FORBIDDEN',
        'Confirm your email address before signing in. Check your inbox for the confirmation link.',
      );
    }
    if (row.status === 'PENDING_APPROVAL') {
      await recordAudit({
        action: AUDIT.LOGIN_BLOCKED, entityType: 'user', entityId: row.id, outcome: 'DENIED',
        actor: { id: row.id, email: row.email, role: row.role as Role },
        metadata: { reason: 'AWAITING_APPROVAL' },
        ipAddress: context.ipAddress, userAgent: context.userAgent,
      });
      throw new AppError(
        'FORBIDDEN',
        'Your account is awaiting administrator approval. You will be emailed when it is granted.',
      );
    }
    if (row.status === 'REJECTED' || row.status === 'SUSPENDED' || row.status === 'DEACTIVATED') {
      await recordAudit({
        action: AUDIT.LOGIN_BLOCKED, entityType: 'user', entityId: row.id, outcome: 'DENIED',
        actor: { id: row.id, email: row.email, role: row.role as Role },
        metadata: { reason: row.status },
        ipAddress: context.ipAddress, userAgent: context.userAgent,
      });
      // Deliberately generic: a deactivated account should look the same as a
      // wrong password to anyone who is not its owner.
      throw genericFailure();
    }
  }

  if (!valid || !row.isActive) {
    const failed = row.failedLogins + 1;
    const shouldLock = failed >= MAX_FAILED_LOGINS;
    await db.update(users).set({
      failedLogins: failed,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : row.lockedUntil,
    }).where(eq(users.id, row.id));

    await recordAudit({
      action: AUDIT.LOGIN_FAILED, entityType: 'user', entityId: row.id, outcome: 'FAILURE',
      actor: { id: row.id, email: row.email, role: row.role as Role },
      metadata: { reason: valid ? 'INACTIVE_ACCOUNT' : 'BAD_PASSWORD', attempt: failed },
      ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    throw genericFailure();
  }

  const { token, expiresAt } = await issueSession({
    userId: row.id,
    role: row.role as Role,
    email: row.email,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  await db.update(users)
    .set({
      lastLoginAt: new Date(),
      lastLoginIp: context.ipAddress ?? null,
      failedLogins: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, row.id));

  await recordAudit({
    action: AUDIT.LOGIN, entityType: 'user', entityId: row.id,
    actor: { id: row.id, email: row.email, role: row.role as Role },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return {
    user: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role as Role,
      permissions: permissionsForRole(row.role as Role),
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      designation: row.designation,
      specialization: row.specialization,
      staffNumber: row.staffNumber,
    },
    redirectTo: ROLE_HOME[row.role as Role] ?? '/dashboard',
    session: { token, expiresAt },
  };
}

export async function logout(user: AuthUser, context: { ipAddress?: string | null; userAgent?: string | null } = {}) {
  await revokeSession(user.sessionTokenId);
  await recordAudit({
    action: AUDIT.LOGOUT, entityType: 'user', entityId: user.id, actor: user,
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });
}

/**
 * Self-service password change. Requires the current password, and revokes
 * every other session so a compromised session cannot survive the change.
 */
export async function changePassword(
  user: AuthUser,
  input: { currentPassword: string; newPassword: string },
) {
  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) throw new AppError('USER_NOT_FOUND', 'Account could not be found.');

  const valid = await verifyPassword(input.currentPassword, row.passwordHash);
  if (!valid) throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect.');

  const issues = passwordIssues(input.newPassword);
  if (issues.length) throw new AppError('VALIDATION_ERROR', `The new password ${issues.join(', ')}.`);

  await db.update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustReset: false,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await revokeAllSessionsForUser(user.id);

  await recordAudit({ action: AUDIT.PASSWORD_CHANGED, entityType: 'user', entityId: user.id, actor: user });
}
