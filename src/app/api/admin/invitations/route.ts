import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { inviteStaffSchema } from '@/server/validators';
import { inviteStaff } from '@/server/services/registration.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/invitations — invite a colleague with a pre-assigned role.
 * The invitee never chooses their own role; it is baked into the token.
 */
export const POST = protectedRoute(async ({ req, user, ip, userAgent }) => {
  const body = await parseBody(req, inviteStaffSchema);
  const result = await inviteStaff(
    { id: user.id, role: user.role, fullName: user.fullName },
    { email: body.email, role: body.role, departmentId: body.departmentId || null },
    { ipAddress: ip, userAgent },
  );
  return created({ ...result, message: `Invitation sent to ${result.email}.` });
}, { permission: PERMISSIONS.USER_INVITE });
