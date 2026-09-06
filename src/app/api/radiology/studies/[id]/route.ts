import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { studyStatusSchema } from '@/server/validators';
import { updateStudyStatus } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const PATCH = protectedRoute<P>(async ({ req, user, params }) => {
  const { status } = await parseBody(req, studyStatusSchema);
  return ok(await updateStudyStatus(user, params.id, status));
}, { permission: PERMISSIONS.RADIOLOGY_REPORT });
