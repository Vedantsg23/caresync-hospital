'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, ClipboardList, Siren, Pill, BedDouble, Sparkles } from 'lucide-react';
import { dashboardApi, aiApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Section,
  StatTile, patientStatusTone,
} from '@/components/ui';
import { calculateAge, cn, genderLabel, timeAgo } from '@/lib/utils';
import { RecordVitalsModal } from '@/features/patients/modals/record-vitals-modal';
import type { NurseDashboardDto } from '@/types/api';

/**
 * Nursing workspace. Optimised for a busy shift on a tablet: the roster is
 * ordered by acuity, overdue observations are surfaced first, and recording a
 * set of vitals is one tap from the list.
 */
export function NursingDashboard() {
  const { user } = useAuth();
  useRealtime();

  const [vitalsFor, setVitalsFor] = React.useState<{ id: string; name: string } | null>(null);
  const [handover, setHandover] = React.useState<{ content: string; banner: string } | null>(null);
  const [loadingHandover, setLoadingHandover] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'nurse'],
    queryFn: () => dashboardApi.get(),
    refetchInterval: 45_000,
  });

  async function generateHandover() {
    setLoadingHandover(true);
    try {
      const { data: h } = await aiApi.handover();
      setHandover({ content: h.content, banner: h.banner });
    } finally {
      setLoadingHandover(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-space-6">
        <div className="cs-skeleton h-32 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-space-4">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="cs-skeleton h-28 rounded-xl" />)}
        </div>
        <Card><LoadingBlock rows={5} /></Card>
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Unable to load your ward list" message={(error as Error)?.message} onRetry={() => refetch()} />;
  }

  const d = data!.data as NurseDashboardDto;
  const k = d.kpis;
  const hour = new Date().getHours();
  const shift = hour < 8 ? 'night shift' : hour < 16 ? 'day shift' : 'evening shift';

  return (
    <div className="space-y-space-8">
      <div className="bg-primary-container text-on-primary-container p-space-6 sm:p-space-8 rounded-xl relative overflow-hidden shadow-sm">
        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-gradient-to-br from-tertiary-fixed/10 to-transparent rounded-full blur-3xl pointer-events-none" aria-hidden />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-space-4">
          <div className="space-y-space-2 min-w-0">
            <span className="px-space-3 py-1 bg-surface-container-low text-on-surface text-label-md rounded-full font-medium inline-block">
              {user?.departmentName ?? 'Nursing'} · {shift}
            </span>
            <h1 className="text-headline-xl text-on-primary font-bold tracking-tight">
              {user?.fullName ?? 'Nursing'} — ward list
            </h1>
            <p className="text-body-lg text-primary-fixed-dim">
              {k.vitalsDue > 0
                ? `${k.vitalsDue} patient${k.vitalsDue === 1 ? '' : 's'} due for observations, and ${k.critical} needing close attention.`
                : 'Observations are up to date across your assigned patients.'}
            </p>
          </div>
          <Button variant="accent" icon={<Sparkles className="h-4 w-4" />} onClick={generateHandover} loading={loadingHandover} className="shrink-0">
            Generate handover summary
          </Button>
        </div>
      </div>

      {handover ? (
        <Card className="p-space-6 space-y-space-3 border-l-4 border-l-secondary">
          <div className="flex items-center gap-space-2">
            <Sparkles className="h-4 w-4 text-secondary" aria-hidden />
            <span className="text-label-md font-bold uppercase tracking-wider text-secondary">Shift handover</span>
          </div>
          <p className="text-label-md text-on-warning-container bg-warning-container/70 px-space-3 py-1 rounded-lg inline-block">
            {handover.banner}
          </p>
          <p className="text-body-md text-on-surface whitespace-pre-wrap leading-relaxed">{handover.content}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-space-4">
        <StatTile label="Assigned patients" value={k.assignedPatients} icon={<ClipboardList className="h-5 w-5" />} />
        <StatTile label="Critical" value={k.critical} tone={k.critical > 0 ? 'critical' : 'neutral'} icon={<Siren className="h-5 w-5" />} />
        <StatTile label="Needs attention" value={k.needsAttention} tone={k.needsAttention > 0 ? 'attention' : 'neutral'} icon={<Activity className="h-5 w-5" />} />
        <StatTile label="Observations due" value={k.vitalsDue} tone={k.vitalsDue > 0 ? 'attention' : 'neutral'} icon={<Activity className="h-5 w-5" />} />
        <StatTile label="Medications active" value={k.medicationsDue} icon={<Pill className="h-5 w-5" />} />
      </div>

      <Section title="Your patients">
        {d.assignedPatients.length === 0 ? (
          <Card>
            <EmptyState
              icon={<BedDouble className="h-8 w-8" />}
              title="No patients assigned"
              description="Patients admitted to a ward in your department appear here automatically."
            />
          </Card>
        ) : (
          <div className="grid gap-space-3">
            {d.assignedPatients.map((p) => {
              const overdue = !p.lastVitalsAt || Date.now() - new Date(p.lastVitalsAt).getTime() > 4 * 3600_000;
              return (
                <Card key={p.id} className={cn('p-space-5 flex flex-col md:flex-row md:items-center justify-between gap-space-4',
                  overdue && 'border-l-4 border-l-warning')}>
                  <div className="flex items-start gap-space-4 min-w-0">
                    <Avatar
                      name={`${p.firstName} ${p.lastName}`}
                      tone={p.status === 'CRITICAL' ? 'critical' : p.status === 'NEEDS_ATTENTION' ? 'attention' : 'neutral'}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-space-2 flex-wrap">
                        <Link href={`/patients/${p.id}`} className="text-body-md font-semibold text-on-surface hover:text-secondary">
                          {p.firstName} {p.lastName}
                        </Link>
                        <span className="text-label-md text-outline">
                          {calculateAge(p.dateOfBirth)} / {genderLabel(p.gender)}
                        </span>
                        {p.bedCode ? (
                          <span className="px-space-2 py-0.5 bg-surface-container-high text-label-sm font-mono rounded">{p.bedCode}</span>
                        ) : null}
                        <Badge tone={patientStatusTone(p.status)}>
                          {p.status === 'CRITICAL' ? 'Critical' : p.status === 'NEEDS_ATTENTION' ? 'Attention' : 'Stable'}
                        </Badge>
                        {overdue ? <Badge tone="attention" dot>Observations due</Badge> : null}
                      </div>
                      <p className="text-body-sm text-on-surface-variant">{p.admissionReason}</p>
                      <p className="text-label-md text-outline">
                        {p.wardName ?? 'Unassigned ward'} · last observations {p.lastVitalsAt ? timeAgo(p.lastVitalsAt) : 'not recorded'}
                        {p.lastNewsScore != null ? ` · early-warning score ${p.lastNewsScore}` : ''}
                        {Number(p.dueMedications) > 0 ? ` · ${p.dueMedications} active medication(s)` : ''}
                      </p>
                      {p.allergies.length ? (
                        <p className="text-label-md text-error font-medium">Allergies: {p.allergies.join(', ')}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-space-2 shrink-0 self-start md:self-center">
                    <Button size="sm" icon={<Activity className="h-4 w-4" />}
                      onClick={() => setVitalsFor({ id: p.id, name: `${p.firstName} ${p.lastName}` })}>
                      Record vitals
                    </Button>
                    <Link href={`/patients/${p.id}`}>
                      <Button variant="secondary" size="sm">Open chart</Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {d.wardSummary.length > 0 ? (
        <Section title="Ward occupancy">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-space-4">
            {d.wardSummary.map((w) => (
              <Card key={w.id} className="p-space-5">
                <p className="text-body-sm font-semibold text-on-surface">{w.name}</p>
                <p className="text-headline-md font-bold text-on-surface mt-1 tabular-nums">
                  {w.occupied}<span className="text-outline text-body-md font-normal"> / {w.total}</span>
                </p>
                <p className="text-label-md text-outline mt-0.5">{w.available} available</p>
                <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-space-2">
                  <div className="h-full bg-secondary rounded-full" style={{ width: `${w.total ? (w.occupied / w.total) * 100 : 0}%` }} />
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {vitalsFor ? (
        <RecordVitalsModal
          open
          onClose={() => setVitalsFor(null)}
          patientId={vitalsFor.id}
          patientName={vitalsFor.name}
        />
      ) : null}
    </div>
  );
}
