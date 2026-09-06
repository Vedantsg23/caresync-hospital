import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { careTeamSchema } from '@/server/validators';
import { getCareTeam, addCareTeamMember } from '@/server/services/dashboard.service';
import { assertPatientAccess } from '@/server/services/patient-access.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  await assertPatientAccess(user, params.id);
  return ok(await getCareTeam(params.id));
}, { permission: PERMISSIONS.PATIENT_READ });

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  await assertPatientAccess(user, params.id);
  const body = await parseBody(req, careTeamSchema);
  return created(await addCareTeamMember(user.id, { patientId: params.id, ...body }));
}, { permission: PERMISSIONS.CARETEAM_MANAGE });
