import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { changeRoleSchema } from '@/server/validators';
import { changeRole } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** Privileged. Always audited; revokes the target's sessions immediately. */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { role } = await parseBody(req, changeRoleSchema);
  return ok(await changeRole(user, params.id, role));
}, { permission: PERMISSIONS.USER_ROLE_CHANGE });
