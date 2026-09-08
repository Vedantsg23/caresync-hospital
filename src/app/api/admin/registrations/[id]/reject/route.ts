import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { rejectAccountSchema } from '@/server/validators';
import { rejectAccount } from '@/server/services/registration.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

/** POST /api/admin/registrations/{id}/reject */
export const POST = protectedRoute<P>(async ({ req, user, params, ip, userAgent }) => {
  const { reason } = await parseBody(req, rejectAccountSchema);
  const result = await rejectAccount({ id: user.id }, { userId: params.id, reason }, { ipAddress: ip, userAgent });
  return ok(result);
}, { permission: PERMISSIONS.USER_APPROVE });
