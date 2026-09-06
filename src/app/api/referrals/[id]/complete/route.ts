import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { completeReferral } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ user, params }) => {
  return ok(await completeReferral(user, params.id));
}, { permission: PERMISSIONS.REFERRAL_RESPOND });
