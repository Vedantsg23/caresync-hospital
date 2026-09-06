import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { ROLE_HOME } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? (ROLE_HOME[user.role] ?? '/dashboard') : '/login');
}
