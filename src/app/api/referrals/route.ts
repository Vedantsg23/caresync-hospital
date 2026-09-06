import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery } from '@/server/core/api';
import { createReferralSchema, referralListSchema } from '@/server/validators';
import { listReferrals, createReferral, type ReferralStatus } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/referrals?box=incoming|outgoing|all&status=PENDING,ACCEPTED
 * Only referrals the caller is party to (or oversees) are returned.
 */
export const GET = protectedRoute(async ({ req, user }) => {
  const q = parseQuery(req, referralListSchema);
  return ok(await listReferrals(user, {
    box: q.box,
    status: q.status ? (q.status.split(',').filter(Boolean) as ReferralStatus[]) : undefined,
    patientId: q.patientId,
    priority: q.priority,
    limit: q.limit,
  }));
}, { permission: PERMISSIONS.REFERRAL_READ });

/**
 * POST /api/referrals
 * Permission: referral:create
 * Creates the referral, writes the timeline event, notifies the specialist and
 * records the audit entry as one atomic clinical action.
 */
export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createReferralSchema);
  return created(await createReferral(user, body));
}, { permission: PERMISSIONS.REFERRAL_CREATE });
