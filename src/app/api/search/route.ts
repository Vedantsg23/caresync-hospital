import { protectedRoute } from '@/server/core/route';
import { ok, parseQuery } from '@/server/core/api';
import { searchQuerySchema } from '@/server/validators';
import { globalSearch } from '@/server/services/dashboard.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/search?q= - authorization-aware global search. */
export const GET = protectedRoute(async ({ req, user }) => {
  const { q } = parseQuery(req, searchQuerySchema);
  return ok(await globalSearch(user, q));
}, { permission: PERMISSIONS.PATIENT_SEARCH });
