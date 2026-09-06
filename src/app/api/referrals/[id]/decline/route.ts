import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { referralReasonSchema } from '@/server/validators';
import { declineReferral } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { reason } = await parseBody(req, referralReasonSchema);
  return ok(await declineReferral(user, params.id, reason));
}, { permission: PERMISSIONS.REFERRAL_RESPOND });
