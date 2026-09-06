import type { Metadata } from 'next';
import { StaffManagement } from '@/features/admin/staff-management';

export const metadata: Metadata = { title: 'Staff management' };
export const dynamic = 'force-dynamic';

export default function StaffPage() {
  return <StaffManagement />;
}
