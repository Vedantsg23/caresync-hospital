import type { Metadata } from 'next';
import { AuthShell } from '../auth-shell';
import { VerifyEmailClient } from './verify-email-client';

export const metadata: Metadata = { title: 'Confirm your email' };
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Confirm your email" subtitle="One moment while we check your link.">
      <VerifyEmailClient token={token ?? ''} />
    </AuthShell>
  );
}
