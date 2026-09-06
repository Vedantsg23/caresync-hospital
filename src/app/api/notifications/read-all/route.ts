import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { markAllRead } from '@/server/services/notification.service';

export const dynamic = 'force-dynamic';

export const PATCH = protectedRoute(async ({ user }) => {
  return ok({ marked: await markAllRead(user.id), unreadCount: 0 });
});
