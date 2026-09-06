import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { acceptReferral } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ user, params }) => {
  return ok(await acceptReferral(user, params.id));
}, { permission: PERMISSIONS.REFERRAL_RESPOND });
