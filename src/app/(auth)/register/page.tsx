import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { ROLE_HOME } from '@/types/rbac';
import { AuthShell } from '../auth-shell';
import { RegisterForm } from './register-form';
import { WhoCanSignIn } from '../who-can-sign-in';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME[user.role] ?? '/dashboard');

  return (
    <AuthShell
      title="Create an account"
      subtitle="Confirm your email, then a hospital administrator reviews your request and assigns your access."
    >
      <RegisterForm />

      <div className="mt-space-10 pt-space-8 border-t border-outline-variant/50">
        <WhoCanSignIn />
      </div>
    </AuthShell>
  );
}
