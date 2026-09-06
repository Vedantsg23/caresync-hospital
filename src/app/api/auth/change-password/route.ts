import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { changePasswordSchema } from '@/server/validators';
import { changePassword } from '@/server/services/auth.service';
import { clearSessionCookie } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

/** POST /api/auth/change-password - revokes all sessions on success. */
export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, changePasswordSchema);
  await changePassword(user, body);
  await clearSessionCookie();
  return ok({ changed: true, message: 'Password updated. Please sign in again.' });
}, { limit: 5 });
