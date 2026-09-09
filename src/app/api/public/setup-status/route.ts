import { publicRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/setup-status
 *
 * Answers exactly one question: has anybody set this deployment up yet?
 *
 * A production database starts empty, which means the first person to open the
 * site sees a sign-in form that cannot work and a registration form whose
 * request nobody can approve. That is not broken, but it looks broken, and the
 * person who deployed it is usually the person staring at it.
 *
 * The response is a single boolean. It carries no name, no address and no
 * count, and once an administrator exists it says nothing an attacker could
 * use — before one exists it says nothing useful either, because the bootstrap
 * endpoint needs a token that is not guessable. What it buys is an empty system
 * that explains itself instead of one that appears to be failing.
 */
export const GET = publicRoute(async () => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(
      inArray(users.primaryRole, ['SUPER_ADMIN', 'HOSPITAL_ADMIN']),
      eq(users.status, 'ACTIVE'),
      eq(users.isActive, true),
    ));

  return ok({ initialised: (row?.count ?? 0) > 0 });
});
