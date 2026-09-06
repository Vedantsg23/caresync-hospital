'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Scan, Pill, ArrowRight, TriangleAlert, Clock, CheckCircle2 } from 'lucide-react';
import { dashboardApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import { Card, ErrorState, StatTile, Section, Button } from '@/components/ui';
import { titleCase } from '@/lib/utils';
import type { Role } from '@/types/rbac';

const CONFIG: Record<string, {
  title: string; blurb: string; href: string; cta: string;
  icon: React.ReactNode;
  tiles: Array<{ key: string; label: string; tone?: 'critical' | 'attention' | 'neutral'; sublabel?: string }>;
}> = {
  PATHOLOGY: {
    title: 'Pathology worklist',
    blurb: 'Specimens awaiting processing, results to enter and critical values to escalate.',
    href: '/pathology', cta: 'Open worklist',
    icon: <FlaskConical className="h-5 w-5" />,
    tiles: [
      { key: 'pendingOrders', label: 'Awaiting processing', tone: 'attention' },
      { key: 'statOrders', label: 'STAT orders', tone: 'critical' },
      { key: 'completedToday', label: 'Reported today' },
      { key: 'criticalLast24h', label: 'Critical values (24h)', tone: 'critical' },
    ],
  },
  RADIOLOGY: {
    title: 'Imaging worklist',
    blurb: 'Requests to schedule, studies in progress and reports to author.',
    href: '/radiology', cta: 'Open worklist',
    icon: <Scan className="h-5 w-5" />,
    tiles: [
      { key: 'awaitingImaging', label: 'Awaiting imaging', tone: 'attention' },
      { key: 'scheduled', label: 'Scheduled' },
      { key: 'inProgress', label: 'In progress' },
      { key: 'reportedToday', label: 'Reported today' },
    ],
  },
  PHARMACY: {
    title: 'Dispensing worklist',
    blurb: 'Prescriptions awaiting dispensing and the medications currently active on the wards.',
    href: '/pharmacy', cta: 'Open worklist',
    icon: <Pill className="h-5 w-5" />,
    tiles: [
      { key: 'pendingDispensing', label: 'Awaiting dispensing', tone: 'attention' },
      { key: 'activeMedications', label: 'Active on wards' },
      { key: 'dispensedToday', label: 'Dispensed today' },
      { key: 'stopped', label: 'Stopped' },
    ],
  },
};

export function DepartmentDashboard({ role }: { role: Role }) {
  const { user } = useAuth();
  useRealtime();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', role],
    queryFn: () => dashboardApi.get(),
    refetchInterval: 45_000,
  });

  const config = CONFIG[role];

  if (isLoading) {
    return (
      <div className="space-y-space-6">
        <div className="cs-skeleton h-32 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="cs-skeleton h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Unable to load your worklist" message={(error as Error)?.message} onRetry={() => refetch()} />;
  }

  const kpis = ((data!.data as { kpis?: Record<string, number> }).kpis ?? {}) as Record<string, number>;

  return (
    <div className="space-y-space-8">
      <div className="bg-primary-container text-on-primary-container p-space-6 sm:p-space-8 rounded-xl relative overflow-hidden shadow-sm">
        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-gradient-to-br from-tertiary-fixed/10 to-transparent rounded-full blur-3xl pointer-events-none" aria-hidden />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-space-4">
          <div className="space-y-space-2 min-w-0">
            <span className="px-space-3 py-1 bg-surface-container-low text-on-surface text-label-md rounded-full font-medium inline-block">
              {user?.departmentName ?? titleCase(role)}
            </span>
            <h1 className="text-headline-xl text-on-primary font-bold tracking-tight">
              {config?.title ?? 'Department dashboard'}
            </h1>
            <p className="text-body-lg text-primary-fixed-dim max-w-2xl">
              {config?.blurb ?? 'Live view of the work assigned to your department.'}
            </p>
          </div>
          {config ? (
            <Link
              href={config.href}
              className="px-space-4 py-2.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-xl text-body-sm font-semibold
                         hover:opacity-90 transition-all flex items-center gap-space-2 shrink-0"
            >
              {config.cta} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-4">
        {(config?.tiles ?? Object.keys(kpis).map((key) => ({ key, label: titleCase(key), tone: 'neutral' as const }))).map((t) => (
          <StatTile
            key={t.key}
            label={t.label}
            value={kpis[t.key] ?? 0}
            tone={(kpis[t.key] ?? 0) > 0 ? (t.tone ?? 'neutral') : 'neutral'}
            icon={t.tone === 'critical' ? <TriangleAlert className="h-5 w-5" /> : t.tone === 'attention' ? <Clock className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          />
        ))}
      </div>

      {config ? (
        <Section title="Next step">
          <Card className="p-space-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-4">
            <div className="flex items-start gap-space-4 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant flex items-center justify-center shrink-0">
                {config.icon}
              </span>
              <div className="min-w-0">
                <p className="text-body-md font-semibold text-on-surface">{config.cta}</p>
                <p className="text-body-sm text-on-surface-variant mt-0.5">{config.blurb}</p>
              </div>
            </div>
            <Link href={config.href} className="shrink-0">
              <Button icon={<ArrowRight className="h-4 w-4" />}>{config.cta}</Button>
            </Link>
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
