import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { logout } from '@/server/services/auth.service';
import { clearSessionCookie } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout - revokes the session server-side, not just the cookie. */
export const POST = protectedRoute(async ({ user, ip, userAgent }) => {
  await logout(user, { ipAddress: ip, userAgent });
  await clearSessionCookie();
  return ok({ loggedOut: true });
});
