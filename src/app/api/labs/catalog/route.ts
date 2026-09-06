import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listInvestigationCatalog } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req }) => {
  const category = req.nextUrl.searchParams.get('category');
  return ok(await listInvestigationCatalog(category === 'RADIOLOGY' ? 'RADIOLOGY' : category === 'LAB' ? 'LAB' : undefined));
}, { permission: PERMISSIONS.LAB_READ });
