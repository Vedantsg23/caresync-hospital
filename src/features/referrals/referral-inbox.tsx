'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Send, ArrowRight, Siren } from 'lucide-react';
import { referralsApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Avatar, Badge, Card, EmptyState, ErrorState, LoadingBlock, StatTile,
  priorityTone, referralStatusTone,
} from '@/components/ui';
import { calculateAge, cn, genderLabel, timeAgo, titleCase } from '@/lib/utils';
import type { ReferralDto } from '@/types/api';

const BOXES = [
  { id: 'incoming', label: 'Referrals to me' },
  { id: 'outgoing', label: 'Referrals I sent' },
  { id: 'all', label: 'All referrals' },
] as const;

const STATUS_FILTERS = [
  { id: '', label: 'All' },
  { id: 'PENDING,REQUESTED_INFORMATION', label: 'Needs action' },
  { id: 'ACCEPTED,IN_PROGRESS', label: 'In progress' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'DECLINED,CANCELLED', label: 'Closed' },
];

export function ReferralInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  useRealtime();

  const box = (params.get('box') ?? 'incoming') as 'incoming' | 'outgoing' | 'all';
  const [status, setStatus] = React.useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['referrals', box, status],
    queryFn: () => referralsApi.list({ box, status: status || undefined }),
    refetchInterval: 45_000,
  });

  const referrals = React.useMemo(() => data?.data ?? [], [data]);

  const counts = React.useMemo(() => ({
    needsAction: referrals.filter((r) => ['PENDING', 'REQUESTED_INFORMATION'].includes(r.status)).length,
    inProgress: referrals.filter((r) => ['ACCEPTED', 'IN_PROGRESS'].includes(r.status)).length,
    completed: referrals.filter((r) => r.status === 'COMPLETED').length,
    emergency: referrals.filter((r) => r.priority === 'EMERGENCY' && !['COMPLETED', 'DECLINED', 'CANCELLED'].includes(r.status)).length,
  }), [referrals]);

  function setBox(next: string) {
    const q = new URLSearchParams(params.toString());
    q.set('box', next);
    router.replace(`/referrals?${q}`, { scroll: false });
  }

  return (
    <div className="space-y-space-6">
      <div>
        <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Referrals</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          {box === 'incoming'
            ? 'Patients other clinicians have referred to you for a specialist opinion.'
            : box === 'outgoing'
              ? 'Referrals you have raised, and the specialist responses that came back.'
              : 'Every referral you are party to.'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
        <StatTile label="Needs your action" value={counts.needsAction}
          tone={counts.needsAction > 0 ? 'attention' : 'neutral'} icon={<Inbox className="h-5 w-5" />} />
        <StatTile label="In progress" value={counts.inProgress} icon={<Send className="h-5 w-5" />} />
        <StatTile label="Completed" value={counts.completed} icon={<ArrowRight className="h-5 w-5" />} />
        <StatTile label="Emergency" value={counts.emergency}
          tone={counts.emergency > 0 ? 'critical' : 'neutral'} icon={<Siren className="h-5 w-5" />} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-3 px-space-4 py-space-3 border-b border-outline-variant/40">
          <div className="flex items-center gap-space-1" role="tablist" aria-label="Referral box">
            {BOXES.map((b) => (
              <button
                key={b.id}
                role="tab"
                aria-selected={box === b.id}
                onClick={() => setBox(b.id)}
                className={cn('px-space-3 py-1.5 rounded-lg text-body-sm font-medium transition-colors whitespace-nowrap',
                  box === b.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high')}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-space-1 overflow-x-auto cs-scroll">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id || 'all'}
                onClick={() => setStatus(f.id)}
                className={cn('px-space-3 py-1.5 rounded-full text-label-md font-medium transition-colors whitespace-nowrap',
                  status === f.id ? 'bg-surface-container-highest text-on-surface' : 'text-outline hover:text-on-surface-variant')}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <LoadingBlock rows={4} />
        ) : isError ? (
          <ErrorState title="Unable to load referrals" message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : referrals.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title={box === 'incoming' ? 'No referrals waiting for you' : box === 'outgoing' ? 'You have not raised any referrals' : 'No referrals found'}
            description={
              box === 'incoming'
                ? 'When a colleague refers a patient to you, it arrives here and you are notified in real time.'
                : 'Open a patient record and choose "Refer to specialist" to start one.'
            }
          />
        ) : (
          <ul className="divide-y divide-outline-variant/30">
            {referrals.map((r) => (
              <li key={r.id}>
                <ReferralRow referral={r} viewerId={user?.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReferralRow({ referral: r, viewerId }: { referral: ReferralDto; viewerId?: string }) {
  const isIncoming = r.specialistDoctorId === viewerId;
  const needsAction = isIncoming
    ? ['PENDING', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status)
    : r.status === 'REQUESTED_INFORMATION';

  return (
    <Link
      href={`/referrals/${r.id}`}
      className={cn('flex flex-col md:flex-row md:items-center justify-between gap-space-4 px-space-6 py-space-4 transition-colors',
        'hover:bg-surface-container-low/60',
        r.priority === 'EMERGENCY' && !['COMPLETED', 'DECLINED', 'CANCELLED'].includes(r.status) && 'bg-error-container/20')}
    >
      <div className="flex items-start gap-space-4 min-w-0">
        <Avatar
          name={`${r.patientFirstName} ${r.patientLastName}`}
          tone={r.patientStatus === 'CRITICAL' ? 'critical' : r.priority === 'EMERGENCY' ? 'critical' : 'info'}
        />
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-space-2 flex-wrap">
            <span className="text-body-md font-semibold text-on-surface">
              {r.patientFirstName} {r.patientLastName}
            </span>
            <span className="text-label-md text-outline">
              {calculateAge(r.patientDob)} / {genderLabel(r.patientGender)}
            </span>
            <span className="font-mono text-label-md text-outline">{r.patientNumber}</span>
            <Badge tone={priorityTone(r.priority)}>{titleCase(r.priority)}</Badge>
            <Badge tone={referralStatusTone(r.status)}>{titleCase(r.status)}</Badge>
            {needsAction ? <Badge tone="attention" dot>Action needed</Badge> : null}
          </div>

          <p className="text-body-sm text-on-surface font-medium">{r.reason}</p>

          <p className="text-label-md text-outline">
            <span className="font-mono">{r.referralNumber}</span>
            {' · '}
            {isIncoming
              ? `From ${r.referringDoctorName} (${r.fromDepartmentName})`
              : `To ${r.specialistDoctorName} (${r.toDepartmentName})`}
            {' · raised '}{timeAgo(r.createdAt)}
          </p>

          {r.patientAllergies.length ? (
            <p className="text-label-md text-error font-medium">Allergies: {r.patientAllergies.join(', ')}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-space-2 shrink-0 self-start md:self-center text-label-md text-secondary font-semibold">
        Open referral <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </div>
    </Link>
  );
}
