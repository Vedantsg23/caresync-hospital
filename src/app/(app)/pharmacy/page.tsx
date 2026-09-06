import type { Metadata } from 'next';
import { PharmacyWorklist } from '@/features/departments/pharmacy-worklist';

export const metadata: Metadata = { title: 'Pharmacy' };
export const dynamic = 'force-dynamic';

export default function PharmacyPage() {
  return <PharmacyWorklist />;
}
