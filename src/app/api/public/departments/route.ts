import { publicRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { departments } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/departments
 *
 * The registration form needs department names before the applicant has an
 * account, so this is deliberately unauthenticated. It returns two columns —
 * id and name — and nothing else: no staff, no counts, no patient-derived
 * numbers. A hospital's department list is not a secret; who works in them is.
 */
export const GET = publicRoute(async () => {
  const rows = await db
    .select({ id: departments.id, name: departments.name, code: departments.code })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(asc(departments.name))
    .limit(100);

  return ok(rows);
});
