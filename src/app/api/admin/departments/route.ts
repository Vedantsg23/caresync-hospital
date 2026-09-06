import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { createDepartmentSchema } from '@/server/validators';
import { listDepartments, createDepartment } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => ok(await listDepartments()),
  { permission: PERMISSIONS.DEPARTMENT_MANAGE });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createDepartmentSchema);
  return created(await createDepartment(user, body));
}, { permission: PERMISSIONS.DEPARTMENT_MANAGE });
