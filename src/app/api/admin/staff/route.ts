import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { createStaffSchema, roleSchema } from '@/server/validators';
import { listStaff, createStaff } from '@/server/services/admin.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const roleParam = sp.get('role');
  const parsedRole = roleParam ? roleSchema.safeParse(roleParam) : null;
  const active = sp.get('isActive');
  return ok(await listStaff({
    role: parsedRole?.success ? parsedRole.data : undefined,
    departmentId: sp.get('departmentId') ?? undefined,
    isActive: active === null ? undefined : active === 'true',
    q: sp.get('q') ?? undefined,
  }));
}, { permission: PERMISSIONS.USER_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createStaffSchema);
  return created(await createStaff(user, body));
}, { permission: PERMISSIONS.USER_CREATE });
