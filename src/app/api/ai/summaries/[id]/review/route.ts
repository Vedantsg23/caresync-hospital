import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { markSummaryReviewed } from '@/server/services/ai';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** A clinician acknowledging they have read and checked the generated text. */
export const POST = protectedRoute<P>(async ({ user, params }) => {
  return ok(await markSummaryReviewed(user, params.id));
}, { permission: PERMISSIONS.AI_USE });
