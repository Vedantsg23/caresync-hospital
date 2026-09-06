import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReferralInbox } from '@/features/referrals/referral-inbox';
import { LoadingBlock } from '@/components/ui';

export const metadata: Metadata = { title: 'Referrals' };
export const dynamic = 'force-dynamic';

export default function ReferralsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={5} />}>
      <ReferralInbox />
    </Suspense>
  );
}
