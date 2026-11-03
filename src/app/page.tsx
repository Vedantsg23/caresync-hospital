import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { ROLE_HOME } from '@/types/rbac';
import { Landing } from './_landing/landing';

export const dynamic = 'force-dynamic';

/**
 * Signed in: straight to the role's home, as before. Signed out: the landing
 * page, which explains what CareSync is before asking anyone to sign in.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME[user.role] ?? '/dashboard');
  return <Landing />;
}
