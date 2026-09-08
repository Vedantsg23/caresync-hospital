import '@/server/only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { hashPassword, passwordIssues, verifyPassword } from '@/server/auth/password';
import { issueToken, consumeToken } from '@/server/auth/tokens';
import { revokeAllSessionsForUser } from '@/server/auth/session';
import { recordAudit, AUDIT } from '@/server/core/audit';
import { sendQuietly } from '@/server/mail';
import { getEnv } from '@/lib/env';

/**
 * Forgotten-password recovery.
 *
 * The hard part of a reset flow is not the cryptography, it is refusing to
 * answer the question "does this address have an account?". `requestReset`
 * therefore returns the same thing for a known and an unknown address, does the
 * same amount of visible work, and only the mail that is (or is not) sent
 * differs. Anything else turns the endpoint into a membership oracle for a
 * hospital's staff list.
 */

const APP_NAME = 'CareSync Hospital';

function appOrigin(): string {
  const env = getEnv();
  return (env.APP_ORIGIN || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function requestPasswordReset(
  email: string,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const address = email.trim().toLowerCase();

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, address))
    .limit(1);

  await recordAudit({
    action: AUDIT.PASSWORD_RESET_REQUESTED,
    entityType: 'user',
    entityId: user?.id ?? null,
    outcome: user ? 'SUCCESS' : 'DENIED',
    metadata: { email: address, known: Boolean(user) },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  // Nothing to do, and nothing to say. The caller cannot tell this apart from
  // the successful branch.
  if (!user) return;

  // A rejected or deactivated account must not be recoverable — resetting the
  // password of an account somebody revoked would quietly undo the revocation.
  if (user.status === 'REJECTED' || user.status === 'DEACTIVATED' || user.status === 'SUSPENDED') {
    return;
  }

  const { token, expiresAt } = await issueToken({
    email: address,
    purpose: 'PASSWORD_RESET',
    userId: user.id,
    ipAddress: context.ipAddress,
  });

  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000);

  await sendQuietly({
    to: address,
    subject: `${APP_NAME}: reset your password`,
    text:
      `Hello ${user.fullName},\n\n`
      + `Someone requested a password reset for your ${APP_NAME} account.\n\n`
      + `Set a new password here:\n\n`
      + `${appOrigin()}/reset-password?token=${token}\n\n`
      + `The link expires in ${minutes} minutes and can be used once.\n\n`
      + `If you did not request this, you can ignore this email — your password has not changed. `
      + `Nobody can reset it without access to this inbox.`,
  });
}

export async function resetPassword(
  input: { token: string; newPassword: string },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ email: string }> {
  const issues = passwordIssues(input.newPassword);
  if (issues.length) {
    throw new AppError('VALIDATION_ERROR', `The new password ${issues.join(', ')}.`, [
      { field: 'newPassword', message: `The new password ${issues.join(', ')}.` },
    ]);
  }

  const resolved = await consumeToken(input.token, 'PASSWORD_RESET');
  if (!resolved || !resolved.userId) {
    throw new AppError('NOT_FOUND', 'This reset link is invalid, already used, or has expired.');
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      passwordHash: users.passwordHash,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, resolved.userId))
    .limit(1);

  if (!user) throw new AppError('USER_NOT_FOUND', 'The account no longer exists.');

  // Re-using the current password is not a reset. Worth refusing, because a
  // person doing it usually believes they have changed something.
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw new AppError('VALIDATION_ERROR', 'Choose a password you have not used before.', [
      { field: 'newPassword', message: 'Choose a password you have not used before.' },
    ]);
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustReset: false,
      passwordChangedAt: new Date(),
      // A reset is the documented way back in after lockout.
      failedLogins: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Every existing session dies. If the reset happened because the account was
  // compromised, leaving the attacker's session alive would defeat the point.
  await revokeAllSessionsForUser(user.id);

  await sendQuietly({
    to: user.email,
    subject: `${APP_NAME}: your password was changed`,
    text:
      `Hello ${user.fullName},\n\n`
      + `Your ${APP_NAME} password was just changed, and every signed-in session was ended.\n\n`
      + `If this was not you, contact your hospital administrator immediately.`,
  });

  await recordAudit({
    action: AUDIT.PASSWORD_RESET_COMPLETED,
    entityType: 'user',
    entityId: user.id,
    userId: user.id,
    outcome: 'SUCCESS',
    metadata: { email: user.email },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { email: user.email };
}
