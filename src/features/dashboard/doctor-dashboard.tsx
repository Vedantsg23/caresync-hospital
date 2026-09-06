'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Siren, ClipboardList, FlaskConical, CalendarClock, ArrowRight, Activity,
  Sparkles, MonitorCheck, Send, Loader2,
} from 'lucide-react';
import { dashboardApi, aiApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Section, StatTile,
  Avatar, patientStatusTone,
} from '@/components/ui';
import { calculateAge, cn, genderLabel, timeAgo, formatTime } from '@/lib/utils';
import type { DoctorDashboardDto } from '@/types/api';

export function DoctorDashboard() {
  const { user } = useAuth();
  useRealtime();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'doctor'],
    queryFn: () => dashboardApi.get(),
    refetchInterval: 45_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-space-6">
        <div className="cs-skeleton h-40 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-space-4">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="cs-skeleton h-28 rounded-xl" />)}
        </div>
        <Card><LoadingBlock rows={4} /></Card>
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Unable to load your dashboard" message={(error as Error)?.message} onRetry={() => refetch()} />;
  }

  const d = data!.data as DoctorDashboardDto;
  const k = d.kpis;
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-space-8">
      {/* Welcome banner - Stitch primary-container surface */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-4
                      bg-primary-container text-on-primary-container p-space-6 sm:p-space-8 rounded-xl relative overflow-hidden shadow-sm">
        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-gradient-to-br from-tertiary-fixed/10 to-transparent rounded-full blur-3xl pointer-events-none" aria-hidden />
        <div className="space-y-space-2 z-10 min-w-0">
          <div className="flex items-center gap-space-2 flex-wrap">
            <span className="px-space-3 py-1 bg-surface-container-low text-on-surface text-label-md rounded-full font-medium">
              {user?.departmentName ?? 'Clinical'} Department
            </span>
            <span className="text-tertiary-fixed-dim text-label-md flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-tertiary-fixed-dim animate-pulse" aria-hidden />
              Live monitoring
            </span>
          </div>
          <h1 className="text-headline-xl text-on-primary font-bold tracking-tight">
            {greeting}, {user?.fullName ?? 'Doctor'}
          </h1>
          <p className="text-body-lg text-primary-fixed-dim">
            {k.criticalAttention > 0
              ? `${k.criticalAttention} patient${k.criticalAttention === 1 ? '' : 's'} need${k.criticalAttention === 1 ? 's' : ''} immediate review, and ${k.pendingReferrals} referral${k.pendingReferrals === 1 ? ' is' : 's are'} waiting on you.`
              : 'Nothing critical on your caseload right now. Here is what needs attention today.'}
          </p>
        </div>
        <div className="flex items-center gap-space-3 z-10 shrink-0 flex-wrap">
          <Link
            href="/referrals?box=incoming"
            className="px-space-4 py-2.5 bg-surface text-on-surface rounded-xl text-body-sm font-semibold
                       hover:bg-surface-container-low transition-all flex items-center gap-space-2"
          >
            <CalendarClock className="h-4 w-4" aria-hidden />
            Referral inbox ({k.pendingReferrals})
          </Link>
          <Link
            href="/patients"
            className="px-space-4 py-2.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-xl text-body-sm font-semibold
                       hover:opacity-90 transition-all flex items-center gap-space-2"
          >
            <Send className="h-4 w-4" aria-hidden />
            New consultation
          </Link>
        </div>
      </div>

      {/* KPI row - every figure is a live aggregate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-4">
        <StatTile
          label="Patients under care" value={k.patientsUnderCare}
          sublabel={k.admittedToday > 0 ? `+${k.admittedToday} admitted today` : 'No new admissions'}
          icon={<Users className="h-5 w-5" />}
        />
        <StatTile
          label="Critical attention" value={k.criticalAttention}
          sublabel={k.criticalAttention > 0 ? 'Immediate review' : 'None right now'}
          tone={k.criticalAttention > 0 ? 'critical' : 'neutral'}
          icon={<Siren className="h-5 w-5" />}
        />
        <StatTile
          label="Pending referrals" value={k.pendingReferrals}
          sublabel={k.awaitingSpecialist > 0 ? `${k.awaitingSpecialist} of yours awaiting` : 'Needs sign-off'}
          tone={k.pendingReferrals > 0 ? 'attention' : 'neutral'}
          icon={<ClipboardList className="h-5 w-5" />}
        />
        <StatTile
          label="New results" value={k.newResults}
          sublabel={k.abnormalResults > 0 ? `${k.abnormalResults} abnormal` : 'All within range'}
          icon={<FlaskConical className="h-5 w-5" />}
        />
        <StatTile
          label="Consultations" value={k.consultationsToday} sublabel="Today"
          icon={<CalendarClock className="h-5 w-5" />}
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-6 xl:gap-space-8">
        <div className="lg:col-span-8 space-y-space-8 min-w-0">
          <AiAssistanceCard patients={d.patientsRequiringAttention} />

          <Section
            title={
              <span className="flex items-center gap-space-2">
                Patients requiring attention
                {d.patientsRequiringAttention.length > 0 ? (
                  <Badge tone="critical">{d.patientsRequiringAttention.length} priority</Badge>
                ) : null}
              </span>
            }
            action={
              <Link href="/patients?mineOnly=true" className="text-label-md font-semibold text-secondary hover:underline flex items-center gap-1">
                View full roster <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          >
            {d.patientsRequiringAttention.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<MonitorCheck className="h-8 w-8" />}
                  title="No patients need escalation"
                  description="Every patient on your caseload is currently recorded as stable."
                  action={<Link href="/patients?mineOnly=true"><Button variant="secondary" size="sm">Open my roster</Button></Link>}
                />
              </Card>
            ) : (
              <div className="space-y-space-4">
                {d.patientsRequiringAttention.map((p) => (
                  <AttentionCard key={p.id} patient={p} />
                ))}
              </div>
            )}
          </Section>

          {d.todaysConsultations.length > 0 ? (
            <Section title="Today's consultations">
              <Card>
                <ul className="divide-y divide-outline-variant/40">
                  {d.todaysConsultations.map((c) => (
                    <li key={c.id}>
                      <Link href={`/patients/${c.patientId}`} className="flex items-center justify-between gap-space-4 px-space-6 py-space-4 hover:bg-surface-container-low/60 transition-colors">
                        <div className="flex items-center gap-space-3 min-w-0">
                          <span className="font-mono text-label-md text-outline w-14 shrink-0">{formatTime(c.startTime)}</span>
                          <div className="min-w-0">
                            <p className="text-body-sm font-semibold text-on-surface truncate">{c.patientName}</p>
                            <p className="text-label-md text-outline truncate">
                              {c.encounterType.replace(/_/g, ' ').toLowerCase()} · {c.reason ?? 'No reason recorded'}
                            </p>
                          </div>
                        </div>
                        <Badge tone={c.status === 'COMPLETED' ? 'success' : 'info'}>
                          {c.status === 'COMPLETED' ? 'Completed' : 'In progress'}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          ) : null}
        </div>

        <div className="lg:col-span-4 space-y-space-6 min-w-0">
          <Card>
            <div className="flex items-center justify-between px-space-6 pt-space-6">
              <h2 className="text-headline-md text-on-surface font-bold">Recent activity</h2>
              <span className="text-label-sm text-outline">Across your patients</span>
            </div>
            <div className="p-space-6">
              {d.recentActivity.length === 0 ? (
                <EmptyState title="No recent activity" description="Updates from any department will appear here." className="py-space-8" />
              ) : (
                <div className="space-y-space-6 relative before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container-high">
                  {d.recentActivity.map((e) => (
                    <div key={e.id} className="relative pl-space-6">
                      <span
                        className={cn('absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-surface-container-lowest',
                          e.severity === 'CRITICAL' ? 'bg-error' : e.severity === 'ATTENTION' ? 'bg-warning' : 'bg-secondary')}
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-space-2">
                        <span className="text-label-sm font-semibold text-on-surface">{e.title}</span>
                        <span className="text-label-sm text-outline shrink-0">{timeAgo(e.occurredAt)}</span>
                      </div>
                      <p className="text-body-sm text-on-surface-variant mt-0.5 line-clamp-2">{e.description}</p>
                      <Link href={`/patients/${e.patientId}`} className="text-label-md text-secondary font-semibold hover:underline mt-1 inline-block">
                        {e.patientName}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <div className="bg-primary-container text-on-primary-container p-space-6 rounded-xl shadow-sm space-y-space-4">
            <div className="flex items-center justify-between">
              <span className="text-label-md uppercase tracking-wider text-primary-fixed-dim font-semibold">Ward capacity</span>
              <Activity className="h-4 w-4 text-tertiary-fixed-dim" aria-hidden />
            </div>
            {d.wardCapacity.length === 0 ? (
              <p className="text-body-sm text-primary-fixed-dim">No wards are assigned to your department.</p>
            ) : (
              d.wardCapacity.map((w) => {
                const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0;
                return (
                  <div key={w.id} className="space-y-space-2">
                    <div className="flex justify-between text-body-sm">
                      <span className="text-on-primary-fixed-variant truncate">{w.name}</span>
                      <span className="text-on-primary font-bold tabular-nums shrink-0">{w.occupied} / {w.total}</span>
                    </div>
                    <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-error' : w.isCritical ? 'bg-tertiary-fixed' : 'bg-secondary-container')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
            <Link href="/wards" className="block text-label-md text-primary-fixed-dim hover:text-on-primary pt-space-2">
              Open bed board →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function AttentionCard({ patient: p }: { patient: DoctorDashboardDto['patientsRequiringAttention'][number] }) {
  const critical = p.status === 'CRITICAL';
  const vitals = [
    p.systolic && p.diastolic ? `BP ${p.systolic}/${p.diastolic} mmHg` : null,
    p.heartRate ? `HR ${p.heartRate} bpm` : null,
    p.spo2 ? `SpO2 ${p.spo2}%` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card className="p-space-6 flex flex-col md:flex-row md:items-center justify-between gap-space-4 hover:bg-surface-container-low/40 transition-all">
      <div className="flex items-start gap-space-4 min-w-0">
        <Avatar name={`${p.firstName} ${p.lastName}`} size="lg" tone={critical ? 'critical' : 'attention'} />
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-space-3 flex-wrap">
            <h3 className="text-headline-sm text-on-surface font-bold">{p.firstName} {p.lastName}</h3>
            <span className="text-body-sm text-outline">{calculateAge(p.dateOfBirth)} / {genderLabel(p.gender)}</span>
            {p.bedCode ? (
              <span className="px-space-2.5 py-0.5 bg-surface-container-high text-on-surface text-label-sm font-medium rounded-md font-mono">
                {p.bedCode}
              </span>
            ) : null}
            <Badge tone={patientStatusTone(p.status)}>
              {p.status === 'CRITICAL' ? 'Critical' : 'Needs attention'}
            </Badge>
          </div>
          <p className="text-body-sm text-on-surface-variant font-medium">
            {p.admissionReason ?? 'No admission reason recorded'}
            {vitals ? <span className="text-outline"> · {vitals}</span> : null}
          </p>
          <div className="flex items-center gap-space-3 text-label-sm text-outline pt-0.5 flex-wrap">
            <span>Last observation {p.lastVitalsAt ? timeAgo(p.lastVitalsAt) : 'not recorded'}</span>
            {p.newsScore != null ? (
              <>
                <span aria-hidden>·</span>
                <span className={cn('font-semibold', p.newsScore >= 6 ? 'text-error' : p.newsScore >= 3 ? 'text-on-warning-container' : '')}>
                  Early-warning score {p.newsScore}
                </span>
              </>
            ) : null}
            {p.allergies.length ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-error font-medium">Allergies: {p.allergies.join(', ')}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-space-2 shrink-0 self-start md:self-center">
        <Link href={`/patients/${p.id}?tab=vitals`}>
          <Button variant="secondary" size="sm">Vitals chart</Button>
        </Link>
        <Link href={`/patients/${p.id}`}>
          <Button size="sm">Open chart</Button>
        </Link>
      </div>
    </Card>
  );
}

/**
 * AI assistance surface.
 * The output is advisory, generated from data the clinician already has access
 * to, and is always labelled for review. It never changes the record.
 */
function AiAssistanceCard({ patients }: { patients: DoctorDashboardDto['patientsRequiringAttention'] }) {
  const target = patients[0];
  const [summary, setSummary] = React.useState<{ content: string; keyPoints: string[]; banner: string } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  async function generate() {
    if (!target) return;
    setLoading(true);
    try {
      const { data } = await aiApi.patientSummary({ patientId: target.id, kind: 'PATIENT_SUMMARY' });
      setSummary({ content: data.content, keyPoints: data.keyPoints, banner: data.banner ?? '' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-space-6 space-y-space-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1.5 h-full bg-secondary" aria-hidden />
      <div className="flex items-center justify-between gap-space-3 flex-wrap">
        <div className="flex items-center gap-space-2">
          <Sparkles className="h-4 w-4 text-secondary" aria-hidden />
          <span className="text-label-md font-bold uppercase tracking-wider text-secondary">
            AI assistance — review required
          </span>
        </div>
        <Badge tone="info">Advisory only</Badge>
      </div>

      {summary ? (
        <div className="space-y-space-3">
          <p className="text-label-md text-on-warning-container bg-warning-container/60 px-space-3 py-1.5 rounded-lg inline-block">
            {summary.banner}
          </p>
          <div className="text-body-md text-on-surface whitespace-pre-wrap leading-relaxed">{summary.content}</div>
          {summary.keyPoints.length ? (
            <ul className="grid sm:grid-cols-2 gap-space-2 pt-space-2">
              {summary.keyPoints.filter(Boolean).map((point, i) => (
                <li key={i} className="flex items-start gap-space-2 text-body-sm text-on-surface-variant">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-secondary shrink-0" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-body-md text-on-surface">
          {target ? (
            <>
              A summary of the current clinical picture can be generated for{' '}
              <strong className="font-semibold">{target.firstName} {target.lastName}</strong>
              {target.bedCode ? ` (${target.bedCode})` : ''}, drawn from their observations, laboratory
              values, medication and open referrals. It is assistance for your review, not a clinical decision.
            </>
          ) : (
            'No patient on your caseload currently needs escalation, so there is nothing to summarise.'
          )}
        </p>
      )}

      <div className="flex items-center gap-space-3 pt-space-1 flex-wrap">
        {target ? (
          <Button size="sm" onClick={generate} loading={loading} icon={loading ? undefined : <Sparkles className="h-4 w-4" />}>
            {summary ? 'Regenerate brief' : 'Generate clinical brief'}
          </Button>
        ) : null}
        {target ? (
          <Link href={`/patients/${target.id}`}>
            <Button variant="secondary" size="sm">Open patient record</Button>
          </Link>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>Dismiss</Button>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-outline" aria-hidden /> : null}
      </div>
    </Card>
  );
}
