import type { Metadata } from 'next';
import { ReferralDetail } from '@/features/referrals/referral-detail';

export const metadata: Metadata = { title: 'Referral' };
export const dynamic = 'force-dynamic';

export default async function ReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReferralDetail referralId={id} />;
}
