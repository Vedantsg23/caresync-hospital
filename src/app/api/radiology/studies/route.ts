import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery } from '@/server/core/api';
import { createStudySchema, listQuerySchema } from '@/server/validators';
import { listRadiologyStudies, createRadiologyStudy } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  const q = parseQuery(req, listQuerySchema);
  return ok(await listRadiologyStudies({
    patientId: q.patientId,
    status: q.status ? (q.status.split(',').filter(Boolean) as ('ORDERED' | 'SCHEDULED' | 'IN_PROGRESS' | 'REPORTED' | 'CANCELLED')[]) : undefined,
    limit: q.limit,
  }));
}, { permission: PERMISSIONS.RADIOLOGY_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createStudySchema);
  return created(await createRadiologyStudy(user, body));
}, { permission: PERMISSIONS.RADIOLOGY_ORDER });
