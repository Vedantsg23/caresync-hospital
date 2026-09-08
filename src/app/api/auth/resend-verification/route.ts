import { publicRoute } from '@/server/core/route';
import { ok, parseBody, fail } from '@/server/core/api';
import { rateLimit } from '@/server/core/rate-limit';
import { getEnv } from '@/lib/env';
import { resendVerificationSchema } from '@/server/validators';
import { resendVerification } from '@/server/services/registration.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/resend-verification
 * Always reports success: whether an unverified account exists for this address
 * is not something an anonymous caller gets to learn.
 */
export const POST = publicRoute(async ({ req, ip }) => {
  const rl = await rateLimit(`resend:${ip}`, getEnv().RATE_LIMIT_RESET_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return fail('RATE_LIMITED', 'Too many requests. Please try again later.', 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }
  const { email } = await parseBody(req, resendVerificationSchema);
  await resendVerification(email, ip);
  return ok({ message: 'If that address needs confirming, a new link is on its way.' });
});
