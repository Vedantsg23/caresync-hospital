import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { updatePatientSchema } from '@/server/validators';
import { getPatientHeader, updatePatient, recordPatientView } from '@/server/services/patient.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

/** GET /api/patients/:id - the connected patient view header. Access audited. */
export const GET = protectedRoute<P>(async ({ user, params, ip, userAgent }) => {
  const patient = await getPatientHeader(user, params.id);
  await recordPatientView(user, params.id, { ip, ua: userAgent });
  return ok(patient);
}, { permission: PERMISSIONS.PATIENT_READ });

/** PATCH /api/patients/:id */
export const PATCH = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, updatePatientSchema);
  return ok(await updatePatient(user, params.id, {
    ...body,
    phone: body.phone || undefined,
    email: body.email || undefined,
  }));
}, { permission: PERMISSIONS.PATIENT_UPDATE });
