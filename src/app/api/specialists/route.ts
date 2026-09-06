import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listSpecialists } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/specialists - doctors available to receive a referral. */
export const GET = protectedRoute(async ({ user }) => {
  return ok(await listSpecialists(user.id));
}, { permission: PERMISSIONS.REFERRAL_READ });
