import { publicRoute } from '@/server/core/route';
import { ok, parseBody, fail } from '@/server/core/api';
import { rateLimit } from '@/server/core/rate-limit';
import { getEnv } from '@/lib/env';
import { registerSchema } from '@/server/validators';
import { register } from '@/server/services/registration.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register — self-service staff registration.
 *
 * Public, and heavily rate limited: an open registration endpoint is a spam
 * and enumeration target. The account it creates has no privilege — it cannot
 * sign in until the address is verified AND an administrator has granted it a
 * role.
 */
export const POST = publicRoute(async ({ req, ip, userAgent }) => {
  const limit = await rateLimit(`register:${ip}`, getEnv().RATE_LIMIT_REGISTER_PER_HOUR, 3_600_000);
  if (!limit.allowed) {
    return fail('RATE_LIMITED', 'Too many registration attempts. Please try again later.', 429, {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  const body = await parseBody(req, registerSchema);

  const result = await register(
    {
      email: body.email,
      fullName: body.fullName,
      password: body.password,
      phone: body.phone || null,
      requestedRole: body.requestedRole,
      requestedDepartmentId: body.requestedDepartmentId || null,
      registrationNote: body.registrationNote || null,
    },
    { ipAddress: ip, userAgent },
  );

  // Identical for a new address and one that already exists — the endpoint
  // must not reveal which staff are registered.
  return ok({
    status: result.status,
    message:
      'Check your email for a confirmation link. Once confirmed, an administrator '
      + 'will review your request and assign your role.',
  }, undefined, 201);
});
