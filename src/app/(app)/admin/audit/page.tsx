import type { Metadata } from 'next';
import { AuditTrail } from '@/features/admin/audit-trail';

export const metadata: Metadata = { title: 'Audit trail' };
export const dynamic = 'force-dynamic';

export default function AuditPage() {
  return <AuditTrail />;
}
