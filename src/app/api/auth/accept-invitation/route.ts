import { publicRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery } from '@/server/core/api';
import { acceptInvitationSchema, tokenSchema } from '@/server/validators';
import { acceptInvitation, describeInvitation } from '@/server/services/registration.service';

export const dynamic = 'force-dynamic';

/** GET /api/auth/accept-invitation?token=… — what this invitation grants. */
export const GET = publicRoute(async ({ req }) => {
  const { token } = parseQuery(req, tokenSchema);
  return ok(await describeInvitation(token));
});

/**
 * POST /api/auth/accept-invitation — redeem it.
 * The role comes from the token an administrator issued, never from the body,
 * so accepting an invitation cannot be used to grant yourself more than it offers.
 */
export const POST = publicRoute(async ({ req, ip, userAgent }) => {
  const body = await parseBody(req, acceptInvitationSchema);
  const result = await acceptInvitation(
    {
      token: body.token,
      fullName: body.fullName,
      password: body.password,
      phone: body.phone || null,
      designation: body.designation || null,
    },
    { ipAddress: ip, userAgent },
  );
  return created({ ...result, message: 'Your account is ready. You can sign in now.' });
});
