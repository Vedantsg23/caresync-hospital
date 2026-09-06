'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { labsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  Select, StatTile, priorityTone, resultFlagTone,
} from '@/components/ui';
import { cn, formatDateTime, timeAgo, titleCase } from '@/lib/utils';
import type { LabOrderDto } from '@/types/api';

export function PathologyWorklist() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  useRealtime();

  const [status, setStatus] = React.useState('ORDERED,IN_PROGRESS');
  const [resultFor, setResultFor] = React.useState<LabOrderDto | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lab-orders', status],
    queryFn: () => labsApi.listOrders({ status: status || undefined, limit: 200 }),
    refetchInterval: 30_000,
  });

  const orders = data?.data ?? [];
  const pending = orders.filter((o) => o.status === 'ORDERED').length;
  const stat = orders.filter((o) => o.priority === 'STAT' && o.status !== 'COMPLETED').length;
  const abnormal = orders.reduce((n, o) => n + Number(o.abnormalCount ?? 0), 0);

  return (
    <div className="space-y-space-6">
      <div>
        <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Pathology worklist</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          Specimens awaiting processing and results to enter. Critical values are escalated automatically.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
        <StatTile label="Awaiting results" value={pending} tone={pending > 0 ? 'attention' : 'neutral'} icon={<FlaskConical className="h-5 w-5" />} />
        <StatTile label="STAT orders" value={stat} tone={stat > 0 ? 'critical' : 'neutral'} />
        <StatTile label="Orders shown" value={orders.length} />
        <StatTile label="Abnormal values" value={abnormal} tone={abnormal > 0 ? 'attention' : 'neutral'} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-space-3 px-space-4 py-space-3 border-b border-outline-variant/40">
          <div className="flex items-center gap-space-2 flex-wrap">
            {[
              { id: 'ORDERED,IN_PROGRESS', label: 'Awaiting results' },
              { id: 'COMPLETED', label: 'Reported' },
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
        </div>

        {isLoading ? <LoadingBlock rows={5} />
          : isError ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
          : orders.length === 0 ? (
            <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Nothing on the worklist"
              description="Laboratory orders raised by clinicians appear here as soon as they are placed." />
          ) : (
            <div className="overflow-x-auto cs-scroll">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="text-left border-b border-outline-variant/40">
                    {['Order', 'Patient', 'Panel', 'Priority', 'Status', 'Ordered', 'Results', ''].map((h) => (
                      <th key={h} className="px-space-4 py-space-3 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {orders.map((o) => (
                    <tr key={o.id} className={cn('text-body-sm', o.priority === 'STAT' && o.status !== 'COMPLETED' && 'bg-error-container/20')}>
                      <td className="px-space-4 py-space-3 font-mono text-on-surface-variant whitespace-nowrap">{o.orderNumber}</td>
                      <td className="px-space-4 py-space-3">
                        <Link href={`/patients/${o.patientId}`} className="font-semibold text-on-surface hover:text-secondary">
                          {o.patientName}
                        </Link>
                        <span className="block text-label-md text-outline font-mono">{o.patientNumber}</span>
                      </td>
                      <td className="px-space-4 py-space-3 text-on-surface">{o.panel}</td>
                      <td className="px-space-4 py-space-3"><Badge tone={priorityTone(o.priority)}>{titleCase(o.priority)}</Badge></td>
                      <td className="px-space-4 py-space-3">
                        <Badge tone={o.status === 'COMPLETED' ? 'success' : 'info'}>{titleCase(o.status)}</Badge>
                      </td>
                      <td className="px-space-4 py-space-3 text-outline whitespace-nowrap">{timeAgo(o.orderedAt)}</td>
                      <td className="px-space-4 py-space-3">
                        {o.resultCount > 0 ? (
                          <span className="text-on-surface-variant">
                            {o.resultCount} value{o.resultCount === 1 ? '' : 's'}
                            {o.abnormalCount > 0 ? <Badge tone="attention" className="ml-2">{o.abnormalCount} abnormal</Badge> : null}
                          </span>
                        ) : <span className="text-outline">Pending</span>}
                      </td>
                      <td className="px-space-4 py-space-3 text-right">
                        {o.status !== 'COMPLETED' ? (
                          <Button size="sm" onClick={() => setResultFor(o)}>Enter results</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {resultFor ? (
        <EnterResultsModal
          order={resultFor}
          onClose={() => setResultFor(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            push({ title: 'Results reported', description: 'The ordering clinician and care team have been notified.', tone: 'success' });
            setResultFor(null);
          }}
          onError={(e) => showError(e, 'The results could not be saved.')}
        />
      ) : null}
    </div>
  );
}

type ResultRow = { analyte: string; value: string; unit: string; investigationCode: string };

function EnterResultsModal({ order, onClose, onSaved, onError }: {
  order: LabOrderDto; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void;
}) {
  const catalog = useQuery({ queryKey: ['lab-catalog'], queryFn: () => labsApi.catalog('LAB'), staleTime: 600_000 });

  const panelAnalytes = React.useMemo(
    () => (catalog.data?.data ?? []).filter((c) => c.panel === order.panel),
    [catalog.data, order.panel],
  );

  const [rows, setRows] = React.useState<ResultRow[]>([{ analyte: '', value: '', unit: '', investigationCode: '' }]);
  const [issue, setIssue] = React.useState<string | null>(null);

  // Prefill the rows with the analytes this panel is made of.
  React.useEffect(() => {
    if (panelAnalytes.length && rows.length === 1 && !rows[0]!.analyte) {
      setRows(panelAnalytes.map((a) => ({ analyte: a.name, value: '', unit: a.unit ?? '', investigationCode: a.code })));
    }
  }, [panelAnalytes, rows]);

  const mutation = useMutation({
    mutationFn: () => labsApi.recordResults(order.id, rows
      .filter((r) => r.analyte.trim() && r.value.trim())
      .map((r) => ({
        analyte: r.analyte.trim(),
        value: r.value.trim(),
        unit: r.unit.trim() || undefined,
        investigationCode: r.investigationCode || undefined,
      }))),
    onSuccess: onSaved,
    onError: (e) => {
      if (e instanceof ApiError) setIssue(e.message);
      onError(e);
    },
  });

  const update = (i: number, patch: Partial<ResultRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const valid = rows.some((r) => r.analyte.trim() && r.value.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={`Enter results — ${order.panel}`}
      description={`${order.patientName} (${order.patientNumber}) · order ${order.orderNumber}. Values are flagged against their reference ranges automatically.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!valid}>
            Report results
          </Button>
        </>
      }
    >
      <div className="space-y-space-4">
        {issue ? (
          <p className="text-body-sm text-on-error-container bg-error-container px-space-3 py-space-2 rounded-lg">{issue}</p>
        ) : null}

        <div className="space-y-space-3">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_100px_auto] gap-space-2 items-end">
              <Field label={i === 0 ? 'Analyte' : undefined} htmlFor={`analyte-${i}`}>
                <Select
                  id={`analyte-${i}`}
                  value={row.investigationCode}
                  onChange={(e) => {
                    const found = (catalog.data?.data ?? []).find((c) => c.code === e.target.value);
                    update(i, { investigationCode: e.target.value, analyte: found?.name ?? '', unit: found?.unit ?? '' });
                  }}
                >
                  <option value="">Select analyte</option>
                  {(catalog.data?.data ?? []).map((c) => (
                    <option key={c.id} value={c.code}>{c.name}{c.panel ? ` (${c.panel})` : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label={i === 0 ? 'Value' : undefined} htmlFor={`value-${i}`}>
                <Input id={`value-${i}`} value={row.value} onChange={(e) => update(i, { value: e.target.value })}
                  className="font-mono" placeholder="0.0" inputMode="decimal" />
              </Field>
              <Field label={i === 0 ? 'Unit' : undefined} htmlFor={`unit-${i}`}>
                <Input id={`unit-${i}`} value={row.unit} onChange={(e) => update(i, { unit: e.target.value })} className="font-mono" />
              </Field>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={rows.length === 1}
                className="p-2 mb-0.5 rounded-lg text-outline hover:text-error hover:bg-error-container/40 disabled:opacity-30"
                aria-label={`Remove row ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setRows((prev) => [...prev, { analyte: '', value: '', unit: '', investigationCode: '' }])}
        >
          Add another analyte
        </Button>

        {order.results?.length ? (
          <div className="pt-space-4 border-t border-outline-variant/50">
            <p className="text-label-md uppercase tracking-wider text-outline font-semibold mb-space-2">Already reported</p>
            <ul className="space-y-1">
              {order.results.map((r) => (
                <li key={r.id} className="flex items-center justify-between text-body-sm">
                  <span className="text-on-surface">{r.analyte}</span>
                  <span className="flex items-center gap-space-2">
                    <span className="font-mono">{r.value} {r.unit}</span>
                    <Badge tone={resultFlagTone(r.flag)}>{titleCase(r.flag)}</Badge>
                    <span className="text-outline text-label-md">{formatDateTime(r.resultedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
