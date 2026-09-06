import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { referralResponseSchema } from '@/server/validators';
import { respondToReferral } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/**
 * POST /api/referrals/:id/respond
 * Records assessment, findings, recommendations, treatment plan and follow-up.
 * The response is also written to the chart as a specialist note.
 */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, referralResponseSchema);
  return created(await respondToReferral(user, params.id, body));
}, { permission: PERMISSIONS.REFERRAL_RESPOND });
