import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { AuthProvider } from '@/components/providers';
import { AppShell } from '@/components/layout/app-shell';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell. The session is resolved on the server, so the first
 * paint already knows the user's role - no flash of the wrong navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <AuthProvider
      user={{
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions,
        departmentId: user.departmentId,
        departmentName: user.departmentName,
        departmentCode: user.departmentCode,
        designation: user.designation,
        specialization: user.specialization,
        staffNumber: user.staffNumber,
        acceptsReferrals: user.acceptsReferrals,
      }}
    >
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
