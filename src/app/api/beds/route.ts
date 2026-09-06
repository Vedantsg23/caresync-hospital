import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { createBedSchema } from '@/server/validators';
import { listBeds, createBed } from '@/server/services/admission.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  const wardId = req.nextUrl.searchParams.get('wardId') ?? undefined;
  return ok(await listBeds(wardId));
}, { permission: PERMISSIONS.WARD_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createBedSchema);
  return created(await createBed(user, body));
}, { permission: PERMISSIONS.WARD_MANAGE });
