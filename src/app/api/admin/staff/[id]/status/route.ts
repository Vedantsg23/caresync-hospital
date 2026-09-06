import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { setActiveSchema } from '@/server/validators';
import { setStaffActive } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { isActive } = await parseBody(req, setActiveSchema);
  return ok(await setStaffActive(user, params.id, isActive));
}, { permission: PERMISSIONS.USER_UPDATE });
