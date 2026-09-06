import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { dischargeSchema } from '@/server/validators';
import { dischargePatient } from '@/server/services/admission.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { summary } = await parseBody(req, dischargeSchema);
  return ok(await dischargePatient(user, params.id, summary));
}, { permission: PERMISSIONS.ADMISSION_DISCHARGE });
