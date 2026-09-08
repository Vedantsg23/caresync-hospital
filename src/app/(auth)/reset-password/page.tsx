import type { Metadata } from 'next';
import { AuthShell } from '../auth-shell';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Set a new password' };
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a new password. Every device signed into this account will be signed out."
    >
      <ResetPasswordForm token={token ?? ''} />
    </AuthShell>
  );
}
