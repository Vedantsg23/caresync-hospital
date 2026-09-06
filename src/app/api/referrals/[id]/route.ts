import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { getReferral } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** GET /api/referrals/:id - referral with its full response history. */
export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await getReferral(user, params.id));
}, { permission: PERMISSIONS.REFERRAL_READ });
