import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { createConversationSchema } from '@/server/validators';
import { listConversations, createConversation } from '@/server/services/messaging.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ user }) => ok(await listConversations(user)),
  { permission: PERMISSIONS.MESSAGE_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createConversationSchema);
  return created(await createConversation(user, body));
}, { permission: PERMISSIONS.MESSAGE_SEND });
