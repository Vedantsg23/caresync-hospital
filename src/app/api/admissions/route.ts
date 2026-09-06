import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery } from '@/server/core/api';
import { createAdmissionSchema, listQuerySchema } from '@/server/validators';
import { listAdmissions, createAdmission } from '@/server/services/admission.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  const q = parseQuery(req, listQuerySchema);
  return ok(await listAdmissions({
    status: q.status ? q.status.split(',').filter(Boolean) : ['ADMITTED'],
    limit: q.limit,
  }));
}, { permission: PERMISSIONS.ADMISSION_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createAdmissionSchema);
  return created(await createAdmission(user, body));
}, { permission: PERMISSIONS.ADMISSION_CREATE });
