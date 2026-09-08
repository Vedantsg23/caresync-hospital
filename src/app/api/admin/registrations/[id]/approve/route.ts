import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { approveAccountSchema } from '@/server/validators';
import { approveAccount } from '@/server/services/registration.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

/**
 * POST /api/admin/registrations/{id}/approve
 * The granted role comes from the approver's input, never from what the
 * applicant asked for. The service additionally refuses to let anyone but a
 * SUPER_ADMIN mint an administrator.
 */
export const POST = protectedRoute<P>(async ({ req, user, params, ip, userAgent }) => {
  const body = await parseBody(req, approveAccountSchema);
  const result = await approveAccount(
    { id: user.id, role: user.role },
    {
      userId: params.id,
      role: body.role,
      departmentId: body.departmentId || null,
      designation: body.designation ?? null,
      specialization: body.specialization ?? null,
      registrationNumber: body.registrationNumber ?? null,
      acceptsReferrals: body.acceptsReferrals,
    },
    { ipAddress: ip, userAgent },
  );
  return ok(result);
}, { permission: PERMISSIONS.USER_APPROVE });
