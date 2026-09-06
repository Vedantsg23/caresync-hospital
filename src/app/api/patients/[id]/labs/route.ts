import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { getPatientLabs } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await getPatientLabs(user, params.id));
}, { permission: PERMISSIONS.LAB_READ });
