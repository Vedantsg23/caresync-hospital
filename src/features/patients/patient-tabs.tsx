'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, FileText, FlaskConical, Scan, Pill, Send, FileStack, Sparkles,
  TrendingUp, Download, CheckCircle2, Clock, AlertTriangle,
} from 'lucide-react';
import { patientsApi, aiApi, filesApi } from '@/lib/api/endpoints';
import {
  Badge, Button, EmptyState, ErrorState, LoadingBlock, DataRow,
  priorityTone, referralStatusTone, resultFlagTone,
} from '@/components/ui';
import { cn, formatBytes, formatDate, formatDateTime, timeAgo, titleCase } from '@/lib/utils';
import type { PatientHeaderDto } from '@/types/api';

/* --------------------------------------------------------------- shared -- */

function TabState<T>({ query, empty, children }: {
  query: { isLoading: boolean; isError: boolean; error: unknown; data?: { data: T }; refetch: () => void };
  empty: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading) return <LoadingBlock rows={4} className="p-0" />;
  if (query.isError) {
    return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  }
  const data = query.data?.data;
  if (!data || (Array.isArray(data) && data.length === 0)) return <>{empty}</>;
  return <>{children(data)}</>;
}

const severityDot = (severity: string) =>
  severity === 'CRITICAL' ? 'bg-error' : severity === 'ATTENTION' ? 'bg-warning' : 'bg-secondary';

/* ------------------------------------------------------------- overview -- */

export function OverviewTab({ patient, onTabChange }: { patient: PatientHeaderDto; onTabChange: (t: string) => void }) {
  const timeline = useQuery({
    queryKey: ['patient', patient.id, 'timeline', 'preview'],
    queryFn: () => patientsApi.getTimeline(patient.id, { limit: 6 }),
  });

  const [summary, setSummary] = React.useState<{ content: string; keyPoints: string[]; banner: string } | null>(null);
  const [generating, setGenerating] = React.useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const { data } = await aiApi.patientSummary({ patientId: patient.id, kind: 'PATIENT_SUMMARY' });
      setSummary({ content: data.content, keyPoints: data.keyPoints, banner: data.banner ?? '' });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-space-6">
      <div className="grid md:grid-cols-2 gap-space-6">
        <section>
          <h3 className="text-label-md uppercase tracking-wider text-outline font-semibold mb-space-3">Current admission</h3>
          {patient.admission ? (
            <div className="space-y-space-1">
              <DataRow label="Reason" value={patient.admission.reason} />
              <DataRow label="Admitted" value={`${formatDateTime(patient.admission.admissionDate)} (${timeAgo(patient.admission.admissionDate)})`} />
              <DataRow label="Status" value={titleCase(patient.admission.status)} />
              <DataRow label="Ward / bed" value={`${patient.admission.wardName ?? '—'}${patient.admission.bedCode ? ` · ${patient.admission.bedCode}` : ''}`} />
              <DataRow label="Attending" value={patient.admission.attendingDoctorName ?? '—'} />
            </div>
          ) : (
            <p className="text-body-sm text-on-surface-variant">This patient is not currently admitted.</p>
          )}
        </section>

        <section>
          <h3 className="text-label-md uppercase tracking-wider text-outline font-semibold mb-space-3">Active medication</h3>
          {patient.activeMedications.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No active medication is recorded.</p>
          ) : (
            <ul className="space-y-space-2">
              {patient.activeMedications.slice(0, 6).map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-space-3 text-body-sm">
                  <span className="text-on-surface font-medium min-w-0">
                    {m.medicineName} <span className="text-outline">{m.dose}</span>
                  </span>
                  <span className="text-outline shrink-0">{m.frequency} · {m.route}</span>
                </li>
              ))}
              {patient.activeMedications.length > 6 ? (
                <li>
                  <button onClick={() => onTabChange('medications')} className="text-label-md text-secondary font-semibold hover:underline">
                    View all {patient.activeMedications.length} medications
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </div>

      {/* AI clinical brief - advisory, always labelled */}
      <section className="border border-secondary/20 bg-secondary-fixed/20 rounded-xl p-space-5">
        <div className="flex items-center justify-between gap-space-3 flex-wrap mb-space-3">
          <span className="flex items-center gap-space-2 text-label-md font-bold uppercase tracking-wider text-secondary">
            <Sparkles className="h-4 w-4" aria-hidden /> AI clinical brief
          </span>
          <Button size="sm" variant="secondary" onClick={generate} loading={generating}>
            {summary ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
        {summary ? (
          <div className="space-y-space-3">
            <p className="text-label-md text-on-warning-container bg-warning-container/70 px-space-3 py-1 rounded-lg inline-block">
              {summary.banner}
            </p>
            <p className="text-body-md text-on-surface whitespace-pre-wrap leading-relaxed">{summary.content}</p>
          </div>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            Composes a summary of this patient&apos;s current picture from their observations, laboratory
            values, imaging, medication and open referrals. Advisory only — always review against the record.
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-space-3">
          <h3 className="text-label-md uppercase tracking-wider text-outline font-semibold">Recent activity</h3>
          <button onClick={() => onTabChange('timeline')} className="text-label-md text-secondary font-semibold hover:underline">
            View full timeline
          </button>
        </div>
        <TabState
          query={timeline}
          empty={<EmptyState title="No recorded activity yet" description="Events appear here as departments contribute to this record." />}
        >
          {(items) => (
            <div className="space-y-space-4 relative before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container-high">
              {items.map((e) => (
                <div key={e.id} className="relative pl-space-6">
                  <span className={cn('absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-surface-container-lowest', severityDot(e.severity))} aria-hidden />
                  <div className="flex items-start justify-between gap-space-3">
                    <p className="text-body-sm font-semibold text-on-surface">{e.title}</p>
                    <span className="text-label-md text-outline shrink-0">{timeAgo(e.occurredAt)}</span>
                  </div>
                  {e.description ? <p className="text-body-sm text-on-surface-variant mt-0.5 line-clamp-2">{e.description}</p> : null}
                  <p className="text-label-md text-outline mt-1">
                    {e.actor?.name ?? 'System'}{e.department ? ` · ${e.department.name}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </TabState>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- timeline -- */

export function TimelineTab({ patientId }: { patientId: string }) {
  const [filter, setFilter] = React.useState<string>('');

  const query = useQuery({
    queryKey: ['patient', patientId, 'timeline', filter],
    queryFn: () => patientsApi.getTimeline(patientId, { limit: 60, types: filter || undefined }),
  });

  const FILTERS = [
    { id: '', label: 'Everything' },
    { id: 'CLINICAL_NOTE', label: 'Notes' },
    { id: 'VITALS_RECORDED,OBSERVATION_RECORDED', label: 'Observations' },
    { id: 'LAB_RESULT,INVESTIGATION_ORDERED', label: 'Investigations' },
    { id: 'RADIOLOGY_REPORT', label: 'Imaging' },
    { id: 'MEDICATION_ORDERED,MEDICATION_UPDATED,MEDICATION_ADMINISTERED', label: 'Medication' },
    { id: 'REFERRAL_CREATED,REFERRAL_ACCEPTED,REFERRAL_RESPONSE,REFERRAL_COMPLETED,REFERRAL_DECLINED', label: 'Referrals' },
  ];

  return (
    <div className="space-y-space-5">
      <div className="flex items-center gap-space-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn('px-space-3 py-1.5 rounded-full text-label-md font-medium transition-colors',
              filter === f.id ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <TabState
        query={query}
        empty={<EmptyState icon={<Clock className="h-8 w-8" />} title="Nothing recorded for this filter" description="Try a different category, or view everything." />}
      >
        {(items) => (
          <ol className="space-y-space-5 relative before:absolute before:left-[7px] before:top-3 before:bottom-3 before:w-0.5 before:bg-surface-container-high">
            {items.map((e) => (
              <li key={e.id} className="relative pl-space-8">
                <span className={cn('absolute left-0 top-2 w-4 h-4 rounded-full border-[3px] border-surface-container-lowest', severityDot(e.severity))} aria-hidden />
                <div className="flex items-start justify-between gap-space-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-space-2 flex-wrap">
                      <p className="text-body-md font-semibold text-on-surface">{e.title}</p>
                      <Badge tone="muted">{titleCase(e.eventType)}</Badge>
                      {e.severity !== 'INFO' ? (
                        <Badge tone={e.severity === 'CRITICAL' ? 'critical' : 'attention'}>{titleCase(e.severity)}</Badge>
                      ) : null}
                    </div>
                    {e.description ? (
                      <p className="text-body-sm text-on-surface-variant mt-1 whitespace-pre-wrap">{e.description}</p>
                    ) : null}
                    <p className="text-label-md text-outline mt-1.5">
                      {e.actor?.name ?? 'System'}
                      {e.actor ? ` · ${titleCase(e.actor.role)}` : ''}
                      {e.department ? ` · ${e.department.name}` : ''}
                    </p>
                  </div>
                  <span className="text-label-md text-outline shrink-0 tabular-nums">{formatDateTime(e.occurredAt)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </TabState>
    </div>
  );
}

/* --------------------------------------------------------------- vitals -- */

export function VitalsTab({ patientId, onRecord }: { patientId: string; onRecord: () => void }) {
  const query = useQuery({ queryKey: ['patient', patientId, 'vitals'], queryFn: () => patientsApi.getVitals(patientId) });
  const trend = useQuery({ queryKey: ['patient', patientId, 'vitals', 'trend'], queryFn: () => patientsApi.getVitalsTrend(patientId, 72) });

  const points = trend.data?.data ?? [];

  return (
    <div className="space-y-space-6">
      <div className="flex items-center justify-between gap-space-4 flex-wrap">
        <h3 className="text-headline-sm text-on-surface font-semibold">Observation chart</h3>
        <Button size="sm" icon={<Activity className="h-4 w-4" />} onClick={onRecord}>Record vitals</Button>
      </div>

      {points.length > 1 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-space-4">
          <Sparkline label="Heart rate" unit="bpm" values={points.map((p) => p.heartRate)} times={points.map((p) => p.recordedAt)} />
          <Sparkline label="Systolic BP" unit="mmHg" values={points.map((p) => p.systolic)} times={points.map((p) => p.recordedAt)} />
          <Sparkline label="SpO2" unit="%" values={points.map((p) => p.spo2)} times={points.map((p) => p.recordedAt)} />
          <Sparkline label="Temperature" unit="°C" values={points.map((p) => p.temperatureC)} times={points.map((p) => p.recordedAt)} />
        </div>
      ) : null}

      <TabState
        query={query}
        empty={
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title="No observations recorded"
            description="Vitals recorded by nursing or medical staff appear here, newest first."
            action={<Button size="sm" onClick={onRecord}>Record the first set</Button>}
          />
        }
      >
        {(rows) => (
          <div className="overflow-x-auto cs-scroll -mx-space-2">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="text-left border-b border-outline-variant/50">
                  {['Recorded', 'BP', 'HR', 'SpO2', 'Temp', 'RR', 'Score', 'By'].map((h) => (
                    <th key={h} className="px-space-3 py-space-2 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {rows.map((v) => (
                  <tr key={v.id} className={cn('font-mono text-body-sm', v.isAbnormal && 'bg-warning-container/25')}>
                    <td className="px-space-3 py-space-3 font-sans text-on-surface-variant whitespace-nowrap">
                      {formatDateTime(v.recordedAt)}
                    </td>
                    <td className="px-space-3 py-space-3">{v.bloodPressureSystolic && v.bloodPressureDiastolic ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}` : '—'}</td>
                    <td className="px-space-3 py-space-3">{v.heartRate ?? '—'}</td>
                    <td className="px-space-3 py-space-3">{v.spo2 ?? '—'}</td>
                    <td className="px-space-3 py-space-3">{v.temperatureC ?? '—'}</td>
                    <td className="px-space-3 py-space-3">{v.respiratoryRate ?? '—'}</td>
                    <td className="px-space-3 py-space-3">
                      {v.newsScore != null ? (
                        <Badge tone={v.newsScore >= 6 ? 'critical' : v.newsScore >= 3 ? 'attention' : 'success'}>{v.newsScore}</Badge>
                      ) : '—'}
                    </td>
                    <td className="px-space-3 py-space-3 font-sans text-on-surface-variant truncate max-w-[160px]">{v.recordedByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabState>
    </div>
  );
}

function Sparkline({ label, unit, values, times }: { label: string; unit: string; values: Array<number | null>; times: string[] }) {
  const clean = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (clean.length < 2) {
    return (
      <div className="bg-surface-container-low rounded-xl p-space-4">
        <p className="text-label-md text-outline uppercase tracking-wider font-semibold">{label}</p>
        <p className="text-body-sm text-outline mt-space-2">Not enough data</p>
      </div>
    );
  }

  const min = Math.min(...clean.map((p) => p.v));
  const max = Math.max(...clean.map((p) => p.v));
  const range = max - min || 1;
  const w = 100;
  const h = 32;
  const path = clean.map((p, idx) => {
    const x = (idx / (clean.length - 1)) * w;
    const y = h - ((p.v - min) / range) * h;
    return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const latest = clean[clean.length - 1]!.v;
  const previous = clean.length > 1 ? clean[clean.length - 2]!.v : latest;
  const rising = latest > previous;

  return (
    <div className="bg-surface-container-low rounded-xl p-space-4">
      <p className="text-label-md text-outline uppercase tracking-wider font-semibold">{label}</p>
      <div className="flex items-end justify-between gap-space-2 mt-space-1">
        <p className="text-headline-md font-mono font-semibold text-on-surface">
          {latest}<span className="text-label-md text-outline ml-1 font-sans">{unit}</span>
        </p>
        <TrendingUp className={cn('h-3.5 w-3.5', rising ? 'text-error' : 'text-on-tertiary-fixed-variant rotate-180')} aria-hidden />
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 mt-space-2 overflow-visible" preserveAspectRatio="none" role="img" aria-label={`${label} trend over the last 72 hours`}>
        <path d={path} fill="none" stroke="#4059aa" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-label-sm text-outline mt-1">{timeAgo(times[times.length - 1] ?? '')}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- notes -- */

export function NotesTab({ patientId, onAdd }: { patientId: string; onAdd: () => void }) {
  const [type, setType] = React.useState('');
  const query = useQuery({
    queryKey: ['patient', patientId, 'notes', type],
    queryFn: () => patientsApi.getNotes(patientId, type || undefined),
  });

  const TYPES = ['', 'ADMISSION', 'PROGRESS', 'CONSULTATION', 'NURSING', 'SPECIALIST', 'DISCHARGE'];

  return (
    <div className="space-y-space-5">
      <div className="flex items-center justify-between gap-space-4 flex-wrap">
        <div className="flex items-center gap-space-2 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t || 'all'}
              onClick={() => setType(t)}
              className={cn('px-space-3 py-1.5 rounded-full text-label-md font-medium transition-colors',
                type === t ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high')}
            >
              {t ? titleCase(t) : 'All notes'}
            </button>
          ))}
        </div>
        <Button size="sm" icon={<FileText className="h-4 w-4" />} onClick={onAdd}>Add note</Button>
      </div>

      <TabState
        query={query}
        empty={<EmptyState icon={<FileText className="h-8 w-8" />} title="No clinical notes recorded" description="Notes written by any member of the care team appear here." action={<Button size="sm" onClick={onAdd}>Write the first note</Button>} />}
      >
        {(notes) => (
          <div className="space-y-space-4">
            {notes.map((n) => (
              <article key={n.id} className="border border-outline-variant/60 rounded-xl p-space-5 bg-surface-container-lowest">
                <div className="flex items-start justify-between gap-space-4 flex-wrap mb-space-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-space-2 flex-wrap">
                      <h4 className="text-body-md font-semibold text-on-surface">{n.title}</h4>
                      <Badge tone="info">{titleCase(n.noteType)}</Badge>
                      {n.version > 1 ? <Badge tone="muted">Version {n.version}</Badge> : null}
                    </div>
                    <p className="text-label-md text-outline mt-1">
                      {n.authorName} · {titleCase(n.authorRole)}
                      {n.departmentName ? ` · ${n.departmentName}` : ''}
                    </p>
                  </div>
                  <span className="text-label-md text-outline shrink-0">{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="text-body-md text-on-surface whitespace-pre-wrap leading-relaxed">{n.content}</p>
              </article>
            ))}
          </div>
        )}
      </TabState>
    </div>
  );
}

/* ------------------------------------------------------- investigations -- */

export function InvestigationsTab({ patientId, onOrder }: { patientId: string; onOrder: () => void }) {
  const query = useQuery({
    queryKey: ['patient', patientId, 'investigations'],
    queryFn: () => patientsApi.getInvestigations(patientId),
  });

  return (
    <div className="space-y-space-5">
      <div className="flex items-center justify-between gap-space-4">
        <h3 className="text-headline-sm text-on-surface font-semibold">All investigations</h3>
        <Button size="sm" icon={<FlaskConical className="h-4 w-4" />} onClick={onOrder}>Order investigation</Button>
      </div>

      <TabState
        query={query}
        empty={<EmptyState icon={<FlaskConical className="h-8 w-8" />} title="No investigations ordered" description="Pathology and imaging orders appear here together." action={<Button size="sm" onClick={onOrder}>Order an investigation</Button>} />}
      >
        {(orders) => (
          <div className="overflow-x-auto cs-scroll">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="text-left border-b border-outline-variant/50">
                  {['Order', 'Investigation', 'Type', 'Priority', 'Status', 'Ordered by', 'Ordered'].map((h) => (
                    <th key={h} className="px-space-3 py-space-2 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {orders.map((o) => (
                  <tr key={o.id} className="text-body-sm">
                    <td className="px-space-3 py-space-3 font-mono text-on-surface-variant whitespace-nowrap">{o.orderNumber}</td>
                    <td className="px-space-3 py-space-3 text-on-surface font-medium">
                      {o.panel}
                      {o.abnormalCount > 0 ? (
                        <Badge tone="attention" className="ml-2">{o.abnormalCount} abnormal</Badge>
                      ) : null}
                    </td>
                    <td className="px-space-3 py-space-3"><Badge tone="muted">{titleCase(o.category)}</Badge></td>
                    <td className="px-space-3 py-space-3"><Badge tone={priorityTone(o.priority)}>{titleCase(o.priority)}</Badge></td>
                    <td className="px-space-3 py-space-3">
                      <Badge tone={o.status === 'COMPLETED' ? 'success' : o.status === 'CANCELLED' ? 'muted' : 'info'}>
                        {titleCase(o.status)}
                      </Badge>
                    </td>
                    <td className="px-space-3 py-space-3 text-on-surface-variant truncate max-w-[160px]">{o.orderedByName}</td>
                    <td className="px-space-3 py-space-3 text-outline whitespace-nowrap">{timeAgo(o.orderedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabState>
    </div>
  );
}

/* ------------------------------------------------------------ pathology -- */

export function PathologyTab({ patientId }: { patientId: string }) {
  const query = useQuery({ queryKey: ['patient', patientId, 'labs'], queryFn: () => patientsApi.getLabs(patientId) });

  return (
    <TabState
      query={query}
      empty={<EmptyState icon={<FlaskConical className="h-8 w-8" />} title="No laboratory results" description="Results entered by the laboratory appear here, grouped by panel." />}
    >
      {(orders) => (
        <div className="space-y-space-5">
          {orders.map((o) => (
            <section key={o.id} className="border border-outline-variant/60 rounded-xl overflow-hidden">
              <header className="flex items-start justify-between gap-space-4 px-space-5 py-space-3 bg-surface-container-low flex-wrap">
                <div>
                  <div className="flex items-center gap-space-2 flex-wrap">
                    <h4 className="text-body-md font-semibold text-on-surface">{o.panel}</h4>
                    <Badge tone={priorityTone(o.priority)}>{titleCase(o.priority)}</Badge>
                    <Badge tone={o.status === 'COMPLETED' ? 'success' : 'info'}>{titleCase(o.status)}</Badge>
                  </div>
                  <p className="text-label-md text-outline mt-0.5 font-mono">{o.orderNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-label-md text-on-surface-variant">Ordered by {o.orderedByName}</p>
                  <p className="text-label-md text-outline">{formatDateTime(o.orderedAt)}</p>
                </div>
              </header>

              {(o.results ?? []).length === 0 ? (
                <p className="px-space-5 py-space-4 text-body-sm text-on-surface-variant flex items-center gap-space-2">
                  <Clock className="h-4 w-4 text-outline" aria-hidden /> Specimen is with the laboratory. Results are not yet available.
                </p>
              ) : (
                <div className="overflow-x-auto cs-scroll">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr className="text-left border-b border-outline-variant/40">
                        {['Analyte', 'Result', 'Reference range', 'Flag', 'Reported'].map((h) => (
                          <th key={h} className="px-space-5 py-space-2 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/30">
                      {o.results!.map((r) => (
                        <tr key={r.id} className={cn('text-body-sm', r.flag.startsWith('CRITICAL') && 'bg-error-container/25')}>
                          <td className="px-space-5 py-space-3 text-on-surface font-medium">{r.analyte}</td>
                          <td className="px-space-5 py-space-3 font-mono font-semibold text-on-surface">
                            {r.value}{r.unit ? <span className="text-outline font-sans ml-1">{r.unit}</span> : null}
                          </td>
                          <td className="px-space-5 py-space-3 font-mono text-outline">{r.referenceRange ?? '—'}</td>
                          <td className="px-space-5 py-space-3">
                            <Badge tone={resultFlagTone(r.flag)}>{titleCase(r.flag)}</Badge>
                          </td>
                          <td className="px-space-5 py-space-3 text-outline whitespace-nowrap">{formatDateTime(r.resultedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </TabState>
  );
}

/* ------------------------------------------------------------ radiology -- */

export function RadiologyTab({ patientId }: { patientId: string }) {
  const query = useQuery({ queryKey: ['patient', patientId, 'radiology'], queryFn: () => patientsApi.getRadiology(patientId) });

  return (
    <TabState
      query={query}
      empty={<EmptyState icon={<Scan className="h-8 w-8" />} title="No imaging studies" description="Requested studies and radiologist reports appear here." />}
    >
      {(studies) => (
        <div className="space-y-space-4">
          {studies.map((s) => (
            <article key={s.id} className="border border-outline-variant/60 rounded-xl overflow-hidden">
              <header className="flex items-start justify-between gap-space-4 px-space-5 py-space-3 bg-surface-container-low flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-space-2 flex-wrap">
                    <h4 className="text-body-md font-semibold text-on-surface">{s.modality} — {s.bodyPart}</h4>
                    <Badge tone={s.status === 'REPORTED' ? 'success' : s.status === 'CANCELLED' ? 'muted' : 'info'}>{titleCase(s.status)}</Badge>
                    {s.contrastUsed ? <Badge tone="muted">Contrast</Badge> : null}
                    {s.reports.some((r) => r.isCritical) ? <Badge tone="critical">Critical finding</Badge> : null}
                  </div>
                  <p className="text-label-md text-outline mt-0.5">
                    <span className="font-mono">{s.accessionNumber}</span> · {s.description}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-label-md text-on-surface-variant">Requested by {s.requestedByName}</p>
                  <p className="text-label-md text-outline">{formatDateTime(s.requestedAt)}</p>
                </div>
              </header>

              {s.reports.length === 0 ? (
                <p className="px-space-5 py-space-4 text-body-sm text-on-surface-variant flex items-center gap-space-2">
                  <Clock className="h-4 w-4 text-outline" aria-hidden /> Awaiting a radiologist report.
                </p>
              ) : (
                s.reports.map((r) => (
                  <div key={r.id} className="px-space-5 py-space-4 space-y-space-3 border-t border-outline-variant/40">
                    <div>
                      <p className="text-label-md uppercase tracking-wider text-outline font-semibold mb-1">Findings</p>
                      <p className="text-body-md text-on-surface whitespace-pre-wrap leading-relaxed">{r.findings}</p>
                    </div>
                    <div>
                      <p className="text-label-md uppercase tracking-wider text-outline font-semibold mb-1">Impression</p>
                      <p className={cn('text-body-md whitespace-pre-wrap leading-relaxed font-medium',
                        r.isCritical ? 'text-on-error-container bg-error-container/50 px-space-3 py-space-2 rounded-lg' : 'text-on-surface')}>
                        {r.impression}
                      </p>
                    </div>
                    {r.recommendation ? (
                      <div>
                        <p className="text-label-md uppercase tracking-wider text-outline font-semibold mb-1">Recommendation</p>
                        <p className="text-body-md text-on-surface">{r.recommendation}</p>
                      </div>
                    ) : null}
                    <p className="text-label-md text-outline">
                      Reported by {r.radiologistName} · {formatDateTime(r.reportedAt)}
                    </p>
                  </div>
                ))
              )}
            </article>
          ))}
        </div>
      )}
    </TabState>
  );
}

/* ---------------------------------------------------------- medications -- */

export function MedicationsTab({ patientId, onPrescribe }: { patientId: string; onPrescribe: () => void }) {
  const query = useQuery({ queryKey: ['patient', patientId, 'medications'], queryFn: () => patientsApi.getMedications(patientId) });

  return (
    <div className="space-y-space-5">
      <div className="flex items-center justify-between gap-space-4">
        <h3 className="text-headline-sm text-on-surface font-semibold">Medication record</h3>
        <Button size="sm" icon={<Pill className="h-4 w-4" />} onClick={onPrescribe}>Prescribe</Button>
      </div>

      <TabState
        query={query}
        empty={<EmptyState icon={<Pill className="h-8 w-8" />} title="No medication prescribed" description="Prescriptions and their administration record appear here." action={<Button size="sm" onClick={onPrescribe}>Prescribe a medicine</Button>} />}
      >
        {(orders) => (
          <div className="space-y-space-3">
            {orders.map((m) => (
              <article key={m.id} className="border border-outline-variant/60 rounded-xl p-space-4">
                <div className="flex items-start justify-between gap-space-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-space-2 flex-wrap">
                      <h4 className="text-body-md font-semibold text-on-surface">{m.medicineName}</h4>
                      <Badge tone={
                        m.status === 'STOPPED' ? 'muted'
                        : m.status === 'PENDING_DISPENSING' ? 'attention'
                        : m.status === 'DISPENSED' || m.status === 'ACTIVE' ? 'success' : 'info'
                      }>
                        {titleCase(m.status)}
                      </Badge>
                    </div>
                    <p className="text-body-sm text-on-surface-variant mt-1">
                      {m.dose} · {m.frequency} · {titleCase(m.route)}
                      {m.instructions ? ` · ${m.instructions}` : ''}
                    </p>
                    <p className="text-label-md text-outline mt-1">
                      Prescribed by {m.prescriberName} · from {formatDate(m.startDate)}
                      {m.endDate ? ` to ${formatDate(m.endDate)}` : ''}
                    </p>
                    {m.stopReason ? (
                      <p className="text-label-md text-on-warning-container bg-warning-container/50 px-space-2 py-1 rounded mt-space-2 inline-block">
                        Stopped: {m.stopReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-label-md text-outline">{m.administrationCount} administration{m.administrationCount === 1 ? '' : 's'}</p>
                    {m.dispensedAt ? <p className="text-label-md text-outline">Dispensed {timeAgo(m.dispensedAt)}</p> : null}
                  </div>
                </div>

                {(m.administrations ?? []).length > 0 ? (
                  <details className="mt-space-3 pt-space-3 border-t border-outline-variant/40">
                    <summary className="text-label-md text-secondary font-semibold cursor-pointer">
                      Administration record ({m.administrations!.length})
                    </summary>
                    <ul className="mt-space-2 space-y-space-1">
                      {m.administrations!.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-space-3 text-label-md">
                          <span className={cn('flex items-center gap-1.5', a.wasWithheld ? 'text-on-warning-container' : 'text-on-surface-variant')}>
                            {a.wasWithheld ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <CheckCircle2 className="h-3 w-3" aria-hidden />}
                            {a.wasWithheld ? 'Withheld' : `${a.doseGiven} given`} by {a.administeredByName}
                          </span>
                          <span className="text-outline">{formatDateTime(a.administeredAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </TabState>
    </div>
  );
}

/* ------------------------------------------------------------ referrals -- */

export function ReferralsTab({ patientId, onRefer }: { patientId: string; onRefer: () => void }) {
  const query = useQuery({ queryKey: ['patient', patientId, 'referrals'], queryFn: () => patientsApi.getReferrals(patientId) });

  return (
    <div className="space-y-space-5">
      <div className="flex items-center justify-between gap-space-4">
        <h3 className="text-headline-sm text-on-surface font-semibold">Specialist referrals</h3>
        <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={onRefer}>Refer to specialist</Button>
      </div>

      <TabState
        query={query}
        empty={<EmptyState icon={<Send className="h-8 w-8" />} title="No referrals raised" description="Referrals to specialists, and their responses, appear here." action={<Button size="sm" onClick={onRefer}>Raise a referral</Button>} />}
      >
        {(referrals) => (
          <div className="space-y-space-3">
            {referrals.map((r) => (
              <Link
                key={r.id}
                href={`/referrals/${r.id}`}
                className="block border border-outline-variant/60 rounded-xl p-space-4 hover:border-secondary hover:bg-surface-container-low/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-space-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-space-2 flex-wrap">
                      <span className="font-mono text-label-md text-outline">{r.referralNumber}</span>
                      <Badge tone={referralStatusTone(r.status)}>{titleCase(r.status)}</Badge>
                      <Badge tone={priorityTone(r.priority)}>{titleCase(r.priority)}</Badge>
                    </div>
                    <p className="text-body-md font-semibold text-on-surface mt-1">{r.reason}</p>
                    <p className="text-body-sm text-on-surface-variant mt-0.5">
                      {r.referringDoctorName} ({r.fromDepartmentName}) → {r.specialistDoctorName} ({r.toDepartmentName})
                    </p>
                  </div>
                  <span className="text-label-md text-outline shrink-0">{timeAgo(r.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </TabState>
    </div>
  );
}

/* ------------------------------------------------------------ documents -- */

export function DocumentsTab({ patientId }: { patientId: string }) {
  const query = useQuery({ queryKey: ['patient', patientId, 'documents'], queryFn: () => patientsApi.getDocuments(patientId) });

  return (
    <TabState
      query={query}
      empty={
        <EmptyState
          icon={<FileStack className="h-8 w-8" />}
          title="No documents attached"
          description="Uploaded reports and scanned records appear here. Files are served through an authenticated route, never a public link."
        />
      }
    >
      {(docs) => (
        <ul className="divide-y divide-outline-variant/40">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-space-4 py-space-3">
              <div className="flex items-center gap-space-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
                  <FileStack className="h-4 w-4 text-on-surface-variant" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-body-sm font-semibold text-on-surface truncate">{d.fileName}</p>
                  <p className="text-label-md text-outline">
                    {titleCase(d.category)} · {formatBytes(d.sizeBytes)} · {d.uploadedByName} · {timeAgo(d.createdAt)}
                  </p>
                </div>
              </div>
              <a
                href={filesApi.downloadUrl(d.id)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 inline-flex items-center gap-1.5 px-space-3 py-1.5 rounded-lg bg-surface-container-high
                           text-body-sm font-medium text-on-surface hover:bg-surface-container-highest"
              >
                <Download className="h-3.5 w-3.5" aria-hidden /> Open
              </a>
            </li>
          ))}
        </ul>
      )}
    </TabState>
  );
}
