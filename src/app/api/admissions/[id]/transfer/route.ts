import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { transferSchema } from '@/server/validators';
import { transferPatient } from '@/server/services/admission.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** Releases the old bed, occupies the new one, preserves transfer history. */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, transferSchema);
  return ok(await transferPatient(user, params.id, body));
}, { permission: PERMISSIONS.ADMISSION_TRANSFER });
