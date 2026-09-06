import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listStaffDirectory } from '@/server/services/messaging.service';

export const dynamic = 'force-dynamic';

/** GET /api/staff - internal staff directory for messaging and assignment. */
export const GET = protectedRoute(async ({ user }) => {
  return ok(await listStaffDirectory(user.id));
});
