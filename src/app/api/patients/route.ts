import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery, pageMeta } from '@/server/core/api';
import { patientSearchSchema, createPatientSchema } from '@/server/validators';
import { searchPatients, createPatient } from '@/server/services/patient.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients
 * Search + filter + paginate. The authorization predicate is part of the SQL,
 * so an unauthorised record cannot appear in the result set.
 */
export const GET = protectedRoute(async ({ req, user }) => {
  const q = parseQuery(req, patientSearchSchema);
  const result = await searchPatients(user, { ...q, mineOnly: q.mineOnly === 'true' });

  if (q.q) {
    await recordAudit({
      action: AUDIT.PATIENT_SEARCHED, entityType: 'patient', actor: user,
      metadata: { query: q.q, results: result.items.length },
    });
  }

  return ok(result.items, pageMeta(result.page, result.pageSize, result.total));
}, { permission: PERMISSIONS.PATIENT_SEARCH });

/** POST /api/patients - register a new patient. */
export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createPatientSchema);
  const patient = await createPatient(user, {
    ...body,
    phone: body.phone || undefined,
    email: body.email || undefined,
    addressLine: body.addressLine || undefined,
    city: body.city || undefined,
    state: body.state || undefined,
    postalCode: body.postalCode || undefined,
    emergencyContact: body.emergencyContact
      ? { ...body.emergencyContact, email: body.emergencyContact.email || undefined }
      : undefined,
  });
  return created(patient);
}, { permission: PERMISSIONS.PATIENT_CREATE });
