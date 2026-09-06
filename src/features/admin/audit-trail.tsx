'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search, Shield } from 'lucide-react';
import { adminApi } from '@/lib/api/endpoints';
import { Badge, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Select } from '@/components/ui';
import { cn, formatDateTime, titleCase } from '@/lib/utils';
import { ROLE_LABELS } from '@/types/rbac';

const ACTIONS = [
  '', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PATIENT_VIEWED', 'PATIENT_ACCESS_DENIED',
  'PATIENT_CREATED', 'PATIENT_UPDATED', 'ADMISSION_CREATED', 'PATIENT_TRANSFERRED',
  'VITALS_CREATED', 'NOTE_CREATED', 'REFERRAL_CREATED', 'REFERRAL_ACCEPTED',
  'REFERRAL_RESPONDED', 'REFERRAL_COMPLETED', 'LAB_RESULT_CREATED',
  'RADIOLOGY_REPORT_CREATED', 'MEDICATION_CREATED', 'MEDICATION_DISPENSED',
  'USER_CREATED', 'ROLE_CHANGED', 'FILE_UPLOADED', 'AI_SUMMARY_GENERATED',
];

export function AuditTrail() {
  const [action, setAction] = React.useState('');
  const [q, setQ] = React.useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit', action],
    queryFn: () => adminApi.audit({ action: action || undefined, limit: 200 }),
    refetchInterval: 60_000,
  });

  const entries = React.useMemo(() => {
    const rows = data?.data ?? [];
    if (!q.trim()) return rows;
    const term = q.trim().toLowerCase();
    return rows.filter((r) =>
      r.actorEmail?.toLowerCase().includes(term) ||
      r.actorName?.toLowerCase().includes(term) ||
      r.patientName?.toLowerCase().includes(term) ||
      r.patientNumber?.toLowerCase().includes(term) ||
      r.action.toLowerCase().includes(term));
  }, [data, q]);

  return (
    <div className="space-y-space-6">
      <div>
        <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Audit trail</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          Append-only record of access and change. Entries cannot be edited or deleted — the database rejects both.
        </p>
      </div>

      <Card className="p-space-4">
        <div className="grid md:grid-cols-[1fr_280px] gap-space-3">
          <div className="relative">
            <Search className="absolute left-space-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by staff, patient or action" aria-label="Filter audit entries" className="pl-10" />
          </div>
          <Field label="" htmlFor="action-filter">
            <Select id="action-filter" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
              {ACTIONS.map((a) => <option key={a || 'all'} value={a}>{a ? titleCase(a) : 'All actions'}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? <LoadingBlock rows={6} />
          : isError ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
          : entries.length === 0 ? (
            <EmptyState icon={<ScrollText className="h-8 w-8" />} title="No audit entries match" />
          ) : (
            <div className="overflow-x-auto cs-scroll">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="text-left border-b border-outline-variant/40">
                    {['When', 'Actor', 'Action', 'Entity', 'Patient', 'Outcome', 'Source'].map((h) => (
                      <th key={h} className="px-space-5 py-space-3 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {entries.map((e) => (
                    <tr key={e.id} className={cn('text-body-sm', e.outcome === 'DENIED' && 'bg-error-container/25')}>
                      <td className="px-space-5 py-space-3 text-outline whitespace-nowrap tabular-nums">{formatDateTime(e.createdAt)}</td>
                      <td className="px-space-5 py-space-3">
                        <span className="block text-on-surface font-medium">{e.actorName ?? e.actorEmail ?? 'System'}</span>
                        {e.actorRole ? <span className="block text-label-md text-outline">{ROLE_LABELS[e.actorRole]}</span> : null}
                      </td>
                      <td className="px-space-5 py-space-3">
                        <span className={cn('font-medium', e.outcome === 'DENIED' ? 'text-error' : 'text-on-surface')}>
                          {titleCase(e.action)}
                        </span>
                      </td>
                      <td className="px-space-5 py-space-3 text-on-surface-variant">{e.entityType}</td>
                      <td className="px-space-5 py-space-3">
                        {e.patientId ? (
                          <Link href={`/patients/${e.patientId}`} className="text-secondary font-medium hover:underline">
                            {e.patientName}
                            <span className="block text-label-md text-outline font-mono">{e.patientNumber}</span>
                          </Link>
                        ) : <span className="text-outline">—</span>}
                      </td>
                      <td className="px-space-5 py-space-3">
                        <Badge tone={e.outcome === 'SUCCESS' ? 'success' : e.outcome === 'DENIED' ? 'critical' : 'attention'}>
                          {titleCase(e.outcome)}
                        </Badge>
                      </td>
                      <td className="px-space-5 py-space-3 font-mono text-label-md text-outline">{e.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <div className="flex items-start gap-space-3 px-space-5 py-space-4 rounded-xl bg-surface-container-low">
        <Shield className="h-5 w-5 text-secondary shrink-0 mt-0.5" aria-hidden />
        <p className="text-body-sm text-on-surface-variant">
          Denied access attempts are recorded here too. If a clinician tries to open a patient they are not
          involved in caring for, the attempt is logged with their identity and refused.
        </p>
      </div>
    </div>
  );
}
