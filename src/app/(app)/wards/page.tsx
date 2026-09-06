import type { Metadata } from 'next';
import { BedBoard } from '@/features/wards/bed-board';

export const metadata: Metadata = { title: 'Wards & Beds' };
export const dynamic = 'force-dynamic';

export default function WardsPage() {
  return <BedBoard />;
}
