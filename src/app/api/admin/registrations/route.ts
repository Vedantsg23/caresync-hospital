import { protectedRoute } from '@/server/core/route';
import { ok, parseQuery } from '@/server/core/api';
import { cursorPageSchema } from '@/server/validators';
import { listPendingAccounts } from '@/server/services/registration.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/admin/registrations — the approval queue. Cursor paginated. */
export const GET = protectedRoute(async ({ req }) => {
  const q = parseQuery(req, cursorPageSchema);
  const result = await listPendingAccounts({ limit: q.limit, cursor: q.cursor });
  return ok(result.items, { nextCursor: result.nextCursor, total: result.total });
}, { permission: PERMISSIONS.USER_APPROVE });
