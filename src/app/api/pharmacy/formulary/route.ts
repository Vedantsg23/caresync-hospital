import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listFormulary } from '@/server/services/pharmacy.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  return ok(await listFormulary(req.nextUrl.searchParams.get('q') ?? undefined));
}, { permission: PERMISSIONS.MEDICATION_READ });
