import type { Metadata } from 'next';
import { RegistrationQueue } from '@/features/admin/registration-queue';

export const metadata: Metadata = { title: 'Account requests' };
export const dynamic = 'force-dynamic';

export default function RegistrationsPage() {
  return <RegistrationQueue />;
}
