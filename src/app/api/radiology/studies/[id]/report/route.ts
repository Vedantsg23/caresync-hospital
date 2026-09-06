import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { radiologyReportSchema } from '@/server/validators';
import { reportRadiologyStudy } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, radiologyReportSchema);
  return created(await reportRadiologyStudy(user, params.id, body));
}, { permission: PERMISSIONS.RADIOLOGY_REPORT });
