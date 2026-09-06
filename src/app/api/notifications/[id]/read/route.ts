import { protectedRoute } from '@/server/core/route';
import { ok, fail } from '@/server/core/api';
import { markRead, unreadCount } from '@/server/services/notification.service';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const PATCH = protectedRoute<P>(async ({ user, params }) => {
  const updated = await markRead(user.id, params.id);
  if (!updated) return fail('NOT_FOUND', 'Notification could not be found.', 404);
  return ok({ id: params.id, read: true, unreadCount: await unreadCount(user.id) });
});
