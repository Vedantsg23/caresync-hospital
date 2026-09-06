import type { Metadata } from 'next';
import { NursingDashboard } from '@/features/nursing/nursing-dashboard';

export const metadata: Metadata = { title: 'Nursing' };
export const dynamic = 'force-dynamic';

export default function NursingPage() {
  return <NursingDashboard />;
}
