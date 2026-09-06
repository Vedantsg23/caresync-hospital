import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { DoctorDashboard } from '@/features/dashboard/doctor-dashboard';
import { DepartmentDashboard } from '@/features/dashboard/department-dashboard';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (user.role === 'NURSE') redirect('/nursing');
  if (user.role === 'HOSPITAL_ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'HR_ADMIN') redirect('/admin');

  if (user.role === 'SENIOR_DOCTOR' || user.role === 'JUNIOR_DOCTOR') {
    return <DoctorDashboard />;
  }

  return <DepartmentDashboard role={user.role} />;
}
