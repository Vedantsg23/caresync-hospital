import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { resetPasswordSchema } from '@/server/validators';
import { resetStaffPassword } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { newPassword } = await parseBody(req, resetPasswordSchema);
  return ok(await resetStaffPassword(user, params.id, newPassword));
}, { permission: PERMISSIONS.USER_UPDATE, limit: 20 });
