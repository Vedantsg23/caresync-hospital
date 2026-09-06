import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listRolesWithCounts } from '@/server/services/admin.service';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  const roles = await listRolesWithCounts();
  return ok(roles.map((r) => ({ ...r, permissions: ROLE_PERMISSIONS[r.name] ?? [] })));
}, { permission: PERMISSIONS.USER_READ });
