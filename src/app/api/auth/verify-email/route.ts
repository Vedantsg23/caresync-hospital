import { publicRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { tokenSchema } from '@/server/validators';
import { verifyEmail } from '@/server/services/registration.service';

export const dynamic = 'force-dynamic';

/** POST /api/auth/verify-email — redeem an email confirmation link. */
export const POST = publicRoute(async ({ req, ip }) => {
  const { token } = await parseBody(req, tokenSchema);
  const result = await verifyEmail(token, { ipAddress: ip });
  return ok({
    email: result.email,
    status: result.status,
    message: result.status === 'ACTIVE'
      ? 'Your email is confirmed. You can now sign in.'
      : 'Your email is confirmed. An administrator will review your request and assign your role.',
  });
});
