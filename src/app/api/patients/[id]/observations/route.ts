import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { observationSchema } from '@/server/validators';
import { listObservations, recordObservation } from '@/server/services/clinical.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await listObservations(user, params.id));
}, { permission: PERMISSIONS.OBSERVATION_READ });

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, observationSchema);
  return created(await recordObservation(user, { patientId: params.id, ...body }));
}, { permission: PERMISSIONS.OBSERVATION_CREATE });
