import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listReferrals } from '@/server/services/referral.service';
import { assertPatientAccess } from '@/server/services/patient-access.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  await assertPatientAccess(user, params.id);
  return ok(await listReferrals(user, { patientId: params.id, box: 'all' }));
}, { permission: PERMISSIONS.REFERRAL_READ });
