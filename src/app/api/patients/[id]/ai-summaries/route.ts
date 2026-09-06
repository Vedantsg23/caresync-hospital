import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listSummaries } from '@/server/services/ai';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await listSummaries(user, params.id));
}, { permission: PERMISSIONS.AI_USE });
