import type { Metadata } from 'next';
import { AuthShell } from '../auth-shell';
import { AcceptInvitationForm } from './accept-invitation-form';

export const metadata: Metadata = { title: 'Accept your invitation' };
export const dynamic = 'force-dynamic';

export default async function AcceptInvitationPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Accept your invitation"
      subtitle="Set a password to activate the account an administrator created for you."
    >
      <AcceptInvitationForm token={token ?? ''} />
    </AuthShell>
  );
}
