import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { createWardSchema } from '@/server/validators';
import { listWards, createWard } from '@/server/services/admission.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  const departmentId = req.nextUrl.searchParams.get('departmentId') ?? undefined;
  return ok(await listWards(departmentId));
}, { permission: PERMISSIONS.WARD_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createWardSchema);
  return created(await createWard(user, body));
}, { permission: PERMISSIONS.WARD_MANAGE });
