import { protectedRoute } from '@/server/core/route';
import { ok, parseQuery } from '@/server/core/api';
import { auditQuerySchema } from '@/server/validators';
import { listAuditLogs } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/admin/audit - append-only trail. Read requires audit:read. */
export const GET = protectedRoute(async ({ req }) => {
  const q = parseQuery(req, auditQuerySchema);
  const result = await listAuditLogs(q);
  return ok(result.items, { nextCursor: result.nextCursor });
}, { permission: PERMISSIONS.AUDIT_READ });
