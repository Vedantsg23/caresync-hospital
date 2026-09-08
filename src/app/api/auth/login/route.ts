import { publicRoute, } from '@/server/core/route';
import { ok, parseBody, fail } from '@/server/core/api';
import { rateLimit } from '@/server/core/rate-limit';
import { getEnv } from '@/lib/env';
import { loginSchema } from '@/server/validators';
import { login } from '@/server/services/auth.service';
import { setSessionCookie } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Public. Rate limited per IP to blunt credential stuffing.
 */
export const POST = publicRoute(async ({ req, ip, userAgent }) => {
  const rl = await rateLimit(`login:${ip}`, getEnv().RATE_LIMIT_LOGIN_PER_MIN);
  if (!rl.allowed) {
    return fail('RATE_LIMITED', 'Too many sign-in attempts. Please wait a moment and try again.', 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const body = await parseBody(req, loginSchema);
  const { session, ...result } = await login(body, { ipAddress: ip, userAgent });
  await setSessionCookie(session.token, session.expiresAt);
  return ok(result);
});
