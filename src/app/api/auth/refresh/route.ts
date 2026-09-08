import { protectedRoute } from '@/server/core/route';
import { ok, fail } from '@/server/core/api';
import { rotateSession, setSessionCookie } from '@/server/auth/session';
import { recordAudit, AUDIT } from '@/server/core/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/refresh — renew the session by rotating it.
 *
 * Returns 401 rather than renewing when the absolute ceiling has passed, which
 * is the point: a session can be kept alive by use, but not indefinitely.
 */
export const POST = protectedRoute(async ({ user, ip, userAgent }) => {
  const rotated = await rotateSession({
    currentTokenId: user.sessionTokenId,
    userId: user.id,
    role: user.role,
    email: user.email,
    ipAddress: ip,
    userAgent,
  });

  if (!rotated) {
    return fail('SESSION_EXPIRED', 'Your session has reached its maximum age. Please sign in again.', 401);
  }

  await setSessionCookie(rotated.token, rotated.expiresAt);
  await recordAudit({
    action: AUDIT.SESSION_ROTATED, entityType: 'session', entityId: rotated.tokenId,
    actor: user, ipAddress: ip, userAgent,
  });

  return ok({ expiresAt: rotated.expiresAt.toISOString() });
});
