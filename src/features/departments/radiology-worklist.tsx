'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scan, TriangleAlert } from 'lucide-react';
import { radiologyApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Modal,
  StatTile, Textarea, priorityTone,
} from '@/components/ui';
import { cn, timeAgo, titleCase } from '@/lib/utils';
import type { RadiologyStudyDto } from '@/types/api';

export function RadiologyWorklist() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  useRealtime();

  const [status, setStatus] = React.useState('ORDERED,SCHEDULED,IN_PROGRESS');
  const [reportFor, setReportFor] = React.useState<RadiologyStudyDto | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['radiology-studies', status],
    queryFn: () => radiologyApi.listStudies({ status: status || undefined, limit: 200 }),
    refetchInterval: 30_000,
  });

  const studies = data?.data ?? [];

  const setStudyStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) => radiologyApi.updateStatus(id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['radiology-studies'] });
      push({ title: 'Study updated', tone: 'success' });
    },
    onError: (e) => showError(e, 'The study could not be updated.'),
  });

  return (
    <div className="space-y-space-6">
      <div>
        <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Imaging worklist</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          Requests to schedule, studies in progress, and reports to author.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
        <StatTile label="Requested" value={studies.filter((s) => s.status === 'ORDERED').length}
          tone={studies.some((s) => s.status === 'ORDERED') ? 'attention' : 'neutral'} icon={<Scan className="h-5 w-5" />} />
        <StatTile label="Scheduled" value={studies.filter((s) => s.status === 'SCHEDULED').length} />
        <StatTile label="In progress" value={studies.filter((s) => s.status === 'IN_PROGRESS').length} />
        <StatTile label="Reported" value={studies.filter((s) => s.status === 'REPORTED').length} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-space-2 flex-wrap px-space-4 py-space-3 border-b border-outline-variant/40">
          {[
            { id: 'ORDERED,SCHEDULED,IN_PROGRESS', label: 'Worklist' },
            { id: 'REPORTED', label: 'Reported' },
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
          : studies.length === 0 ? (
            <EmptyState icon={<Scan className="h-8 w-8" />} title="Nothing on the worklist"
              description="Imaging requests raised by clinicians appear here immediately." />
          ) : (
            <ul className="divide-y divide-outline-variant/30">
              {studies.map((s) => (
                <li key={s.id} className="px-space-6 py-space-4 flex flex-col lg:flex-row lg:items-center justify-between gap-space-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-space-2 flex-wrap">
                      <span className="text-body-md font-semibold text-on-surface">{s.modality} — {s.bodyPart}</span>
                      <Badge tone={priorityTone(s.priority)}>{titleCase(s.priority)}</Badge>
                      <Badge tone={s.status === 'REPORTED' ? 'success' : 'info'}>{titleCase(s.status)}</Badge>
                      {s.contrastUsed ? <Badge tone="muted">Contrast</Badge> : null}
                      {s.reports.some((r) => r.isCritical) ? <Badge tone="critical">Critical finding</Badge> : null}
                    </div>
                    <p className="text-body-sm text-on-surface-variant">{s.description}</p>
                    <p className="text-label-md text-outline">
                      <Link href={`/patients/${s.patientId}`} className="text-secondary font-semibold hover:underline">
                        {s.patientName}
                      </Link>
                      {' · '}<span className="font-mono">{s.patientNumber}</span>
                      {' · '}<span className="font-mono">{s.accessionNumber}</span>
                      {' · requested by '}{s.requestedByName}{' '}{timeAgo(s.requestedAt)}
                    </p>
                    {s.clinicalInfo ? <p className="text-label-md text-on-surface-variant">Clinical question: {s.clinicalInfo}</p> : null}
                  </div>

                  <div className="flex items-center gap-space-2 shrink-0">
                    {s.status === 'ORDERED' ? (
                      <Button variant="secondary" size="sm" loading={setStudyStatus.isPending}
                        onClick={() => setStudyStatus.mutate({ id: s.id, next: 'SCHEDULED' })}>
                        Schedule
                      </Button>
                    ) : null}
                    {s.status === 'SCHEDULED' ? (
                      <Button variant="secondary" size="sm" loading={setStudyStatus.isPending}
                        onClick={() => setStudyStatus.mutate({ id: s.id, next: 'IN_PROGRESS' })}>
                        Start study
                      </Button>
                    ) : null}
                    {s.status !== 'REPORTED' && s.status !== 'CANCELLED' ? (
                      <Button size="sm" onClick={() => setReportFor(s)}>Write report</Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setReportFor(s)}>Add addendum</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>

      {reportFor ? (
        <ReportModal
          study={reportFor}
          onClose={() => setReportFor(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['radiology-studies'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            push({ title: 'Report published', description: 'The requesting clinician and care team have been notified.', tone: 'success' });
            setReportFor(null);
          }}
          onError={(e) => showError(e, 'The report could not be saved.')}
        />
      ) : null}
    </div>
  );
}

function ReportModal({ study, onClose, onSaved, onError }: {
  study: RadiologyStudyDto; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void;
}) {
  const [issues, setIssues] = React.useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: { findings: string; impression: string; recommendation?: string; isCritical?: boolean }) =>
      radiologyApi.report(study.id, payload),
    onSuccess: onSaved,
    onError: (e) => {
      if (e instanceof ApiError) setIssues(Object.fromEntries(e.issues.map((i) => [i.field, i.message])));
      onError(e);
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    mutation.mutate({
      findings: String(form.get('findings')).trim(),
      impression: String(form.get('impression')).trim(),
      recommendation: String(form.get('recommendation') ?? '').trim() || undefined,
      isCritical: form.get('isCritical') === 'on',
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Report — ${study.modality} ${study.bodyPart}`}
      description={`${study.patientName} (${study.patientNumber}) · accession ${study.accessionNumber}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="report-form" loading={mutation.isPending}>Publish report</Button>
        </>
      }
    >
      <form id="report-form" onSubmit={submit} className="space-y-space-4" noValidate>
        {study.clinicalInfo ? (
          <p className="text-body-sm text-on-surface-variant bg-surface-container-low px-space-3 py-space-2 rounded-lg">
            <strong className="text-on-surface font-semibold">Clinical question:</strong> {study.clinicalInfo}
          </p>
        ) : null}

        <Field label="Findings" htmlFor="findings" required error={issues.findings}>
          <Textarea id="findings" name="findings" required rows={6} invalid={!!issues.findings} autoFocus
            placeholder="Describe what the study shows, systematically." />
        </Field>

        <Field label="Impression" htmlFor="impression" required error={issues.impression}
          hint="This is what appears on the patient timeline and in the referring clinician's notification.">
          <Textarea id="impression" name="impression" required rows={3} invalid={!!issues.impression}
            placeholder="Right lower lobe pneumonia." />
        </Field>

        <Field label="Recommendation" htmlFor="recommendation">
          <Textarea id="recommendation" name="recommendation" rows={2}
            placeholder="Suggest follow-up radiograph in six weeks to confirm resolution." />
        </Field>

        <label className="flex items-start gap-space-2 px-space-3 py-space-2 rounded-lg bg-error-container/40 cursor-pointer">
          <input type="checkbox" name="isCritical" className="mt-0.5 w-4 h-4 rounded border-outline-variant text-error focus:ring-error" />
          <span className="text-body-sm text-on-error-container">
            <TriangleAlert className="inline h-3.5 w-3.5 mr-1" aria-hidden />
            <strong className="font-semibold">Critical finding.</strong> Escalates the notification and marks the patient record.
          </span>
        </label>
      </form>
    </Modal>
  );
}
