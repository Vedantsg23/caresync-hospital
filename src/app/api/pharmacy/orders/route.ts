import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery } from '@/server/core/api';
import { prescribeSchema, listQuerySchema } from '@/server/validators';
import { listMedicationOrders, prescribeMedication, type MedicationStatus } from '@/server/services/pharmacy.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req, user }) => {
  const q = parseQuery(req, listQuerySchema);
  return ok(await listMedicationOrders({
    patientId: q.patientId,
    status: q.status ? (q.status.split(',').filter(Boolean) as MedicationStatus[]) : undefined,
    limit: q.limit,
  }, user));
}, { permission: PERMISSIONS.MEDICATION_READ });

/** Blocked when the medicine collides with a recorded allergy. */
export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, prescribeSchema);
  return created(await prescribeMedication(user, body));
}, { permission: PERMISSIONS.MEDICATION_PRESCRIBE });
