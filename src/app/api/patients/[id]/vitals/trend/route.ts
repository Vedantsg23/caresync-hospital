import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { vitalsTrend } from '@/server/services/clinical.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = protectedRoute<P>(async ({ req, user, params }) => {
  const hours = Number(req.nextUrl.searchParams.get('hours') ?? 72);
  return ok(await vitalsTrend(user, params.id, Number.isFinite(hours) ? Math.min(hours, 720) : 72));
}, { permission: PERMISSIONS.VITALS_READ });
