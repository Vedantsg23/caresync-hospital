import { publicRoute } from '@/server/core/route';
import { ok, parseBody, fail } from '@/server/core/api';
import { rateLimit } from '@/server/core/rate-limit';
import { getEnv } from '@/lib/env';
import { forgotPasswordSchema } from '@/server/validators';
import { requestPasswordReset } from '@/server/services/password-reset.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password
 *
 * The response is identical for a known and an unknown address. Telling a
 * caller which staff addresses exist would turn this into a directory.
 */
export const POST = publicRoute(async ({ req, ip, userAgent }) => {
  const rl = await rateLimit(`forgot:${ip}`, getEnv().RATE_LIMIT_RESET_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return fail('RATE_LIMITED', 'Too many reset requests. Please try again later.', 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const { email } = await parseBody(req, forgotPasswordSchema);
  await requestPasswordReset(email, { ipAddress: ip, userAgent });

  return ok({
    message: 'If an account exists for that address, a reset link has been sent.',
  });
});
