import { protectedRoute } from '@/server/core/route';
import { ok, parseQuery } from '@/server/core/api';
import { notificationQuerySchema } from '@/server/validators';
import { listNotifications, unreadCount } from '@/server/services/notification.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/notifications?unreadOnly=true - scoped to the caller. */
export const GET = protectedRoute(async ({ req, user }) => {
  const q = parseQuery(req, notificationQuerySchema);
  const result = await listNotifications({
    userId: user.id,
    unreadOnly: q.unreadOnly === 'true',
    limit: q.limit,
    cursor: q.cursor,
  });
  return ok(result.items, { nextCursor: result.nextCursor, unreadCount: await unreadCount(user.id) });
}, { permission: PERMISSIONS.NOTIFICATION_READ, limit: 600 });
