import type { Metadata } from 'next';
import { RadiologyWorklist } from '@/features/departments/radiology-worklist';

export const metadata: Metadata = { title: 'Radiology' };
export const dynamic = 'force-dynamic';

export default function RadiologyPage() {
  return <RadiologyWorklist />;
}
