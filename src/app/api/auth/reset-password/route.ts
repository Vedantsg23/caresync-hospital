import { publicRoute } from '@/server/core/route';
import { ok, parseBody, fail } from '@/server/core/api';
import { rateLimit } from '@/server/core/rate-limit';
import { resetPasswordWithTokenSchema } from '@/server/validators';
import { resetPassword } from '@/server/services/password-reset.service';

export const dynamic = 'force-dynamic';

/** POST /api/auth/reset-password — spend a reset token and set a new password. */
export const POST = publicRoute(async ({ req, ip, userAgent }) => {
  // Rate limited on the token attempt too: a valid token is 256 bits, but an
  // unlimited endpoint is still an unlimited endpoint.
  const rl = await rateLimit(`reset:${ip}`, 20, 3_600_000);
  if (!rl.allowed) {
    return fail('RATE_LIMITED', 'Too many attempts. Please try again later.', 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const body = await parseBody(req, resetPasswordWithTokenSchema);
  await resetPassword(
    { token: body.token, newPassword: body.newPassword },
    { ipAddress: ip, userAgent },
  );

  return ok({
    message: 'Your password has been changed and all sessions were signed out. You can sign in now.',
  });
});
