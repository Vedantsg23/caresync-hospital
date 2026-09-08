import { publicRoute } from '@/server/core/route';
import { created, parseBody, fail } from '@/server/core/api';
import { rateLimit } from '@/server/core/rate-limit';
import { bootstrapSchema } from '@/server/validators';
import { bootstrapFirstAdmin } from '@/server/services/registration.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/bootstrap — create the first administrator of an empty
 * deployment.
 *
 * A production database starts with no users, which leaves nobody able to
 * approve anybody, so there has to be exactly one way in. It requires
 * BOOTSTRAP_TOKEN, which only the operator holds, and the service refuses the
 * moment any active administrator exists — this cannot be used to add a second
 * back door later. Rate limited hard because it is unauthenticated by nature.
 */
export const POST = publicRoute(async ({ req, ip, userAgent }) => {
  const rl = await rateLimit(`bootstrap:${ip}`, 5, 3_600_000);
  if (!rl.allowed) {
    return fail('RATE_LIMITED', 'Too many attempts.', 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const body = await parseBody(req, bootstrapSchema);
  const admin = await bootstrapFirstAdmin(body, { ipAddress: ip, userAgent });

  return created({
    ...admin,
    message: 'Administrator created. Remove BOOTSTRAP_TOKEN from the environment now.',
  });
});
