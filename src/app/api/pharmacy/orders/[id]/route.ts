import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { medicationStatusUpdateSchema } from '@/server/validators';
import { updateMedicationStatus } from '@/server/services/pharmacy.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const PATCH = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, medicationStatusUpdateSchema);
  return ok(await updateMedicationStatus(user, params.id, body));
}, { permission: PERMISSIONS.MEDICATION_UPDATE });
