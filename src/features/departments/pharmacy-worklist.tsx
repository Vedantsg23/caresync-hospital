'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, ShieldAlert, PackageCheck, Ban } from 'lucide-react';
import { pharmacyApi } from '@/lib/api/endpoints';
import { useToast, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Modal,
  StatTile, Textarea,
} from '@/components/ui';
import { cn, formatDate, timeAgo, titleCase } from '@/lib/utils';
import type { MedicationOrderDto } from '@/types/api';

export function PharmacyWorklist() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  useRealtime();

  const [status, setStatus] = React.useState('PENDING_DISPENSING,PENDING');
  const [stopFor, setStopFor] = React.useState<MedicationOrderDto | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['medication-orders', status],
    queryFn: () => pharmacyApi.listOrders({ status: status || undefined, limit: 200 }),
    refetchInterval: 30_000,
  });

  const orders = data?.data ?? [];

  const update = useMutation({
    mutationFn: ({ id, next, stopReason }: { id: string; next: string; stopReason?: string }) =>
      pharmacyApi.updateStatus(id, { status: next, stopReason }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['medication-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      push({
        title: vars.next === 'DISPENSED' ? 'Medication dispensed' : `Medication ${vars.next.toLowerCase().replace('_', ' ')}`,
        description: vars.next === 'DISPENSED' ? 'The prescriber has been notified.' : undefined,
        tone: 'success',
      });
      setStopFor(null);
    },
    onError: (e) => showError(e, 'The medication could not be updated.'),
  });

  return (
    <div className="space-y-space-6">
      <div>
        <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Dispensing worklist</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          Prescriptions awaiting dispensing, and the medications currently active on the wards.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
        <StatTile label="Awaiting dispensing" value={orders.filter((o) => o.status === 'PENDING_DISPENSING').length}
          tone={orders.some((o) => o.status === 'PENDING_DISPENSING') ? 'attention' : 'neutral'} icon={<Pill className="h-5 w-5" />} />
        <StatTile label="Dispensed" value={orders.filter((o) => o.status === 'DISPENSED').length} icon={<PackageCheck className="h-5 w-5" />} />
        <StatTile label="Active" value={orders.filter((o) => o.status === 'ACTIVE').length} />
        <StatTile label="With allergy flags" value={orders.filter((o) => o.patientAllergies.length > 0).length}
          tone={orders.some((o) => o.patientAllergies.length > 0) ? 'attention' : 'neutral'} icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-space-2 flex-wrap px-space-4 py-space-3 border-b border-outline-variant/40">
          {[
            { id: 'PENDING_DISPENSING,PENDING', label: 'Awaiting dispensing' },
            { id: 'DISPENSED,ACTIVE', label: 'Active on wards' },
            { id: 'STOPPED,COMPLETED', label: 'Closed' },
            { id: '', label: 'All' },
          ].map((f) => (
            <button
              key={f.id || 'all'}
              onClick={() => setStatus(f.id)}
              className={cn('px-space-3 py-1.5 rounded-full text-label-md font-medium transition-colors',
                status === f.id ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? <LoadingBlock rows={5} />
          : isError ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
          : orders.length === 0 ? (
            <EmptyState icon={<Pill className="h-8 w-8" />} title="Nothing on the worklist"
              description="Prescriptions raised by clinicians appear here for dispensing." />
          ) : (
            <ul className="divide-y divide-outline-variant/30">
              {orders.map((m) => (
                <li key={m.id} className="px-space-6 py-space-4 flex flex-col lg:flex-row lg:items-center justify-between gap-space-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-space-2 flex-wrap">
                      <span className="text-body-md font-semibold text-on-surface">{m.medicineName}</span>
                      <Badge tone={
                        m.status === 'STOPPED' ? 'muted'
                        : m.status === 'PENDING_DISPENSING' ? 'attention'
                        : m.status === 'DISPENSED' || m.status === 'ACTIVE' ? 'success' : 'info'
                      }>
                        {titleCase(m.status)}
                      </Badge>
                    </div>
                    <p className="text-body-sm text-on-surface-variant">
                      {m.dose} · {m.frequency} · {titleCase(m.route)}
                      {m.instructions ? ` · ${m.instructions}` : ''}
                    </p>
                    <p className="text-label-md text-outline">
                      <Link href={`/patients/${m.patientId}`} className="text-secondary font-semibold hover:underline">
                        {m.patientName}
                      </Link>
                      {' · '}<span className="font-mono">{m.patientNumber}</span>
                      {m.wardName ? ` · ${m.wardName}` : ''}{m.bedCode ? ` ${m.bedCode}` : ''}
                      {' · prescribed by '}{m.prescriberName}{' '}{timeAgo(m.createdAt)}
                      {' · from '}{formatDate(m.startDate)}
                    </p>
                    {m.patientAllergies.length ? (
                      <p className="text-label-md text-error font-medium flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3" aria-hidden /> Patient allergies: {m.patientAllergies.join(', ')}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-space-2 shrink-0">
                    {m.status === 'PENDING_DISPENSING' || m.status === 'PENDING' ? (
                      <Button size="sm" icon={<PackageCheck className="h-4 w-4" />} loading={update.isPending}
                        onClick={() => update.mutate({ id: m.id, next: 'DISPENSED' })}>
                        Dispense
                      </Button>
                    ) : null}
                    {m.status === 'DISPENSED' ? (
                      <Button variant="secondary" size="sm" loading={update.isPending}
                        onClick={() => update.mutate({ id: m.id, next: 'ACTIVE' })}>
                        Mark active
                      </Button>
                    ) : null}
                    {!['STOPPED', 'COMPLETED'].includes(m.status) ? (
                      <Button variant="ghost" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => setStopFor(m)}>
                        Stop
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>

      {stopFor ? (
        <StopModal
          order={stopFor}
          loading={update.isPending}
          onClose={() => setStopFor(null)}
          onConfirm={(reason) => update.mutate({ id: stopFor.id, next: 'STOPPED', stopReason: reason })}
        />
      ) : null}
    </div>
  );
}

function StopModal({ order, onClose, onConfirm, loading }: {
  order: MedicationOrderDto; onClose: () => void; onConfirm: (reason: string) => void; loading: boolean;
}) {
  const [reason, setReason] = React.useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Stop ${order.medicineName}`}
      description={`For ${order.patientName}. A reason is required and is recorded on the patient timeline.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(reason.trim())} loading={loading} disabled={!reason.trim()}>
            Stop medication
          </Button>
        </>
      }
    >
      <Field label="Reason for stopping" htmlFor="stop-reason" required>
        <Textarea id="stop-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Held due to rising creatinine. Review after repeat urea and electrolytes." autoFocus />
      </Field>
    </Modal>
  );
}
