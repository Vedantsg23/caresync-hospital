import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { getPatientInvestigations } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** Unified pathology + imaging order index for the Investigations tab. */
export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await getPatientInvestigations(user, params.id));
}, { permission: PERMISSIONS.LAB_READ });
