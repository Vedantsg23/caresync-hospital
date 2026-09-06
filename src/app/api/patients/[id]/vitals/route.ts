import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { vitalsSchema } from '@/server/validators';
import { listVitals, recordVitals } from '@/server/services/clinical.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await listVitals(user, params.id));
}, { permission: PERMISSIONS.VITALS_READ });

/** POST /api/patients/:id/vitals - saves, scores, timelines and notifies. */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, vitalsSchema);
  return created(await recordVitals(user, { patientId: params.id, ...body }));
}, { permission: PERMISSIONS.VITALS_CREATE });
