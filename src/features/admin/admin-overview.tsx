'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Users, BedDouble, Stethoscope, Send, Siren, Building2, ScrollText, Activity, UserCheck } from 'lucide-react';
import { dashboardApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import { Badge, Card, ErrorState, Section, StatTile } from '@/components/ui';
import { cn, timeAgo, titleCase } from '@/lib/utils';
import type { AdminDashboardDto } from '@/types/api';

export function AdminOverview() {
  const { user } = useAuth();
  useRealtime();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => dashboardApi.get(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-space-6">
        <div className="cs-skeleton h-32 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="cs-skeleton h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (isError) return <ErrorState title="Unable to load the hospital overview" message={(error as Error)?.message} onRetry={() => refetch()} />;

  const d = data!.data as AdminDashboardDto;
  const k = d.kpis;
  const occupancy = k.totalBeds > 0 ? Math.round((k.occupiedBeds / k.totalBeds) * 100) : 0;
  const maxDay = Math.max(1, ...(d.activityByDay ?? []).map((x) => x.count));

  return (
    <div className="space-y-space-8">
      <div className="bg-primary-container text-on-primary-container p-space-6 sm:p-space-8 rounded-xl relative overflow-hidden shadow-sm">
        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-gradient-to-br from-tertiary-fixed/10 to-transparent rounded-full blur-3xl pointer-events-none" aria-hidden />
        <div className="relative z-10 space-y-space-2">
          <span className="px-space-3 py-1 bg-surface-container-low text-on-surface text-label-md rounded-full font-medium inline-block">
            Hospital administration
          </span>
          <h1 className="text-headline-xl text-on-primary font-bold tracking-tight">
            {user?.fullName ?? 'Administrator'} — hospital overview
          </h1>
          <p className="text-body-lg text-primary-fixed-dim max-w-3xl">
            {k.activeAdmissions} active admissions across {occupancy}% bed occupancy, with {k.pendingReferrals} referrals
            awaiting a specialist and {k.criticalAlerts} unread critical alerts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
        <StatTile label="Total patients" value={k.totalPatients} sublabel={`${k.admittedToday} admitted today`} icon={<Users className="h-5 w-5" />} />
        <StatTile label="Active admissions" value={k.activeAdmissions} sublabel={`${k.dischargedToday} discharged today`} icon={<Stethoscope className="h-5 w-5" />} />
        <StatTile label="Critical patients" value={k.criticalPatients} tone={k.criticalPatients > 0 ? 'critical' : 'neutral'}
          sublabel={`${k.attentionPatients} need attention`} icon={<Siren className="h-5 w-5" />} />
        <StatTile label="Critical alerts" value={k.criticalAlerts} tone={k.criticalAlerts > 0 ? 'critical' : 'neutral'} icon={<Siren className="h-5 w-5" />} />

        <StatTile label="Beds occupied" value={`${k.occupiedBeds} / ${k.totalBeds}`} sublabel={`${occupancy}% occupancy`}
          tone={occupancy >= 90 ? 'attention' : 'neutral'} icon={<BedDouble className="h-5 w-5" />} />
        <StatTile label="Beds available" value={k.availableBeds} sublabel={`${k.cleaningBeds} in turnaround`}
          tone={k.availableBeds === 0 ? 'critical' : 'neutral'} />
        <StatTile label="Active staff" value={k.activeStaff} sublabel={`${k.activeDoctors} doctors · ${k.activeNurses} nurses`} icon={<Users className="h-5 w-5" />} />
        <StatTile label="Referrals pending" value={k.pendingReferrals} sublabel={`${k.activeReferrals} in progress · ${k.completedReferrals} completed`}
          tone={k.emergencyReferrals > 0 ? 'critical' : k.pendingReferrals > 0 ? 'attention' : 'neutral'} icon={<Send className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-space-6">
        <Card className="xl:col-span-2 overflow-hidden">
          <div className="px-space-6 py-space-4 border-b border-outline-variant/40 flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface font-semibold">Department activity</h2>
            <Link href="/admin/departments" className="text-label-md text-secondary font-semibold hover:underline">Manage</Link>
          </div>
          <div className="overflow-x-auto cs-scroll">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="text-left border-b border-outline-variant/40">
                  {['Department', 'Staff', 'Admissions', 'Referrals in', 'Referrals out', 'Events (7d)'].map((h) => (
                    <th key={h} className="px-space-5 py-space-3 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {d.departmentActivity.map((dept) => (
                  <tr key={dept.id} className="text-body-sm">
                    <td className="px-space-5 py-space-3">
                      <span className="font-semibold text-on-surface">{dept.name}</span>
                      <span className="block text-label-md text-outline font-mono">{dept.code}</span>
                    </td>
                    <td className="px-space-5 py-space-3 tabular-nums text-on-surface-variant">{dept.staff}</td>
                    <td className="px-space-5 py-space-3 tabular-nums text-on-surface-variant">{dept.activeAdmissions}</td>
                    <td className="px-space-5 py-space-3 tabular-nums text-on-surface-variant">{dept.referralsIn}</td>
                    <td className="px-space-5 py-space-3 tabular-nums text-on-surface-variant">{dept.referralsOut}</td>
                    <td className="px-space-5 py-space-3 tabular-nums text-on-surface-variant">{dept.events7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="px-space-5 py-space-4 border-b border-outline-variant/40">
            <h2 className="text-headline-sm text-on-surface font-semibold flex items-center gap-space-2">
              <Activity className="h-4 w-4 text-secondary" aria-hidden /> Clinical activity
            </h2>
            <p className="text-label-md text-outline mt-0.5">Recorded events per day, last 14 days</p>
          </div>
          <div className="p-space-5">
            <div className="flex items-end gap-1 h-32" role="img" aria-label="Clinical events recorded per day over the last fourteen days">
              {(d.activityByDay ?? []).map((day) => (
                <div key={day.day} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className="w-full bg-secondary rounded-t transition-all group-hover:bg-primary-container"
                    style={{ height: `${Math.max(4, (day.count / maxDay) * 100)}%` }}
                  />
                  <span className="absolute -top-6 opacity-0 group-hover:opacity-100 text-label-sm bg-inverse-surface text-inverse-on-surface px-1.5 py-0.5 rounded whitespace-nowrap transition-opacity">
                    {day.count} on {day.day.slice(5)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-label-sm text-outline mt-space-2">
              <span>{(d.activityByDay ?? [])[0]?.day.slice(5)}</span>
              <span>{(d.activityByDay ?? [])[(d.activityByDay ?? []).length - 1]?.day.slice(5)}</span>
            </div>
          </div>
        </Card>
      </div>

      <Section
        title="Recent audit events"
        action={<Link href="/admin/audit" className="text-label-md text-secondary font-semibold hover:underline">Open the audit trail</Link>}
      >
        <Card className="overflow-hidden">
          <ul className="divide-y divide-outline-variant/30">
            {(d.recentAudit ?? []).map((a) => (
              <li key={a.id} className="px-space-6 py-space-3 flex items-center justify-between gap-space-4">
                <div className="flex items-center gap-space-3 min-w-0">
                  <ScrollText className="h-4 w-4 text-outline shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <span className="text-body-sm font-medium text-on-surface">{titleCase(a.action)}</span>
                    <span className="block text-label-md text-outline truncate">
                      {a.actorEmail ?? 'system'} · {a.entityType}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-space-3 shrink-0">
                  <Badge tone={a.outcome === 'SUCCESS' ? 'success' : a.outcome === 'DENIED' ? 'critical' : 'attention'}>
                    {titleCase(a.outcome)}
                  </Badge>
                  <span className="text-label-md text-outline">{timeAgo(a.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <div className="grid sm:grid-cols-3 gap-space-4">
        {[
          { href: '/admin/registrations', label: 'Account requests', description: 'Review people who registered, grant or refuse their access.', icon: UserCheck },
          { href: '/admin/staff', label: 'Staff management', description: 'Create accounts, assign roles and departments, deactivate leavers.', icon: Users },
          { href: '/admin/departments', label: 'Departments', description: 'Hospital structure, clinical and non-clinical departments.', icon: Building2 },
          { href: '/admin/audit', label: 'Audit trail', description: 'Append-only record of every access and change.', icon: ScrollText },
        ].map((item) => (
          <Link key={item.href} href={item.href}
            className={cn('block p-space-5 rounded-xl border border-outline-variant/50 bg-surface-container-lowest',
              'hover:border-secondary hover:shadow-card transition-all')}>
            <item.icon className="h-5 w-5 text-secondary mb-space-3" aria-hidden />
            <p className="text-body-md font-semibold text-on-surface">{item.label}</p>
            <p className="text-body-sm text-on-surface-variant mt-1">{item.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
