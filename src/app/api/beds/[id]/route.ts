import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { bedStatusSchema } from '@/server/validators';
import { updateBedStatus } from '@/server/services/admission.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const PATCH = protectedRoute<P>(async ({ req, user, params }) => {
  const { status } = await parseBody(req, bedStatusSchema);
  return ok(await updateBedStatus(user, params.id, status));
}, { permission: PERMISSIONS.WARD_MANAGE });
