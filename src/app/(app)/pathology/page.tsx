import type { Metadata } from 'next';
import { PathologyWorklist } from '@/features/departments/pathology-worklist';

export const metadata: Metadata = { title: 'Pathology' };
export const dynamic = 'force-dynamic';

export default function PathologyPage() {
  return <PathologyWorklist />;
}
