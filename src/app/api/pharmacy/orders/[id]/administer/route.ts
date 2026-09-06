import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { administerSchema } from '@/server/validators';
import { administerMedication } from '@/server/services/pharmacy.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** Medication administration record entry - nursing action. */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, administerSchema);
  return created(await administerMedication(user, params.id, body));
}, { permission: PERMISSIONS.MEDICATION_ADMINISTER });
