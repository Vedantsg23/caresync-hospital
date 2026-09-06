import type { Metadata } from 'next';
import { AdminOverview } from '@/features/admin/admin-overview';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminOverview />;
}
