import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { sendMessageSchema } from '@/server/validators';
import { sendMessage } from '@/server/services/messaging.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { body } = await parseBody(req, sendMessageSchema);
  return created(await sendMessage(user, params.id, body));
}, { permission: PERMISSIONS.MESSAGE_SEND });
