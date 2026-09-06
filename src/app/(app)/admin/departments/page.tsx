import type { Metadata } from 'next';
import { DepartmentManagement } from '@/features/admin/department-management';

export const metadata: Metadata = { title: 'Departments' };
export const dynamic = 'force-dynamic';

export default function DepartmentsPage() {
  return <DepartmentManagement />;
}
