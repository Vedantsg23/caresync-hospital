import { protectedRoute } from '@/server/core/route';
import { ok, parseBody, fail } from '@/server/core/api';
import { updateStaffSchema } from '@/server/validators';
import { updateStaff, getStaffById } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ params }) => {
  const staff = await getStaffById(params.id);
  if (!staff) return fail('USER_NOT_FOUND', 'Staff member could not be found.', 404);
  return ok(staff);
}, { permission: PERMISSIONS.USER_READ });

export const PATCH = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, updateStaffSchema);
  return ok(await updateStaff(user, params.id, body));
}, { permission: PERMISSIONS.USER_UPDATE });
