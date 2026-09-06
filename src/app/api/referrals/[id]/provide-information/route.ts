import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { referralAnswerSchema } from '@/server/validators';
import { provideInformation } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/** The referring doctor answers the specialist's question; referral re-queues. */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { answer } = await parseBody(req, referralAnswerSchema);
  return ok(await provideInformation(user, params.id, answer));
}, { permission: PERMISSIONS.REFERRAL_CREATE });
