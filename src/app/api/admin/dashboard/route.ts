import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { getAdminDashboard } from '@/server/services/dashboard.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => ok(await getAdminDashboard()),
  { permission: PERMISSIONS.ADMIN_DASHBOARD });
