import { protectedRoute } from '@/server/core/route';
import { ok, parseBody } from '@/server/core/api';
import { referralQuestionSchema } from '@/server/validators';
import { requestInformation } from '@/server/services/referral.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { question } = await parseBody(req, referralQuestionSchema);
  return ok(await requestInformation(user, params.id, question));
}, { permission: PERMISSIONS.REFERRAL_RESPOND });
