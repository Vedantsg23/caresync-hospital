import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { ROLE_HOME } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me - the caller's identity, role, department and permissions. */
export const GET = protectedRoute(async ({ user }) => {
  return ok({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    permissions: user.permissions,
    departmentId: user.departmentId,
    departmentName: user.departmentName,
    departmentCode: user.departmentCode,
    designation: user.designation,
    specialization: user.specialization,
    staffNumber: user.staffNumber,
    acceptsReferrals: user.acceptsReferrals,
    homeRoute: ROLE_HOME[user.role],
  });
});
