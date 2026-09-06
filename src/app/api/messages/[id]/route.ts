import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { getConversation } from '@/server/services/messaging.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await getConversation(user, params.id));
}, { permission: PERMISSIONS.MESSAGE_READ });
