import type { Metadata } from 'next';
import { AuthShell } from '../auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password' };
export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your work email address and we will send you a link to set a new password."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
