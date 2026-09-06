'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus, Users, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { patientsApi, wardsApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Select, Skeleton,
  patientStatusTone, Avatar,
} from '@/components/ui';
import { bloodGroupLabel, cn, genderLabel, timeAgo } from '@/lib/utils';
import { PERMISSIONS } from '@/types/rbac';
import { NewPatientModal } from './new-patient-modal';

export function PatientList() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();

  const [q, setQ] = React.useState(params.get('q') ?? '');
  const [status, setStatus] = React.useState(params.get('status') ?? '');
  const [wardId, setWardId] = React.useState(params.get('wardId') ?? '');
  const [mineOnly, setMineOnly] = React.useState(params.get('mineOnly') === 'true');
  const [page, setPage] = React.useState(1);
  const [newOpen, setNewOpen] = React.useState(false);

  const debouncedQ = useDebounce(q, 300);
  React.useEffect(() => { setPage(1); }, [debouncedQ, status, wardId, mineOnly]);

  const wards = useQuery({ queryKey: ['wards'], queryFn: () => wardsApi.list(), staleTime: 300_000 });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['patients', debouncedQ, status, wardId, mineOnly, page],
    queryFn: () => patientsApi.search({
      q: debouncedQ || undefined,
      status: status || undefined,
      wardId: wardId || undefined,
      mineOnly: mineOnly || undefined,
      page,
      pageSize: 20,
    }),
    placeholderData: (prev) => prev,
  });

  const meta = data?.meta as { total?: number; totalPages?: number } | undefined;
  const patients = data?.data ?? [];

  return (
    <div className="space-y-space-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-4">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Patient registry</h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            You can only see patients you are involved in caring for.
          </p>
        </div>
        {can(PERMISSIONS.PATIENT_CREATE) ? (
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
            Register patient
          </Button>
        ) : null}
      </div>

      <Card className="p-space-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-space-3 items-center">
          <div className="relative">
            <Search className="absolute left-space-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, patient number or admission number"
              aria-label="Search patients"
              className="pl-10"
            />
          </div>

          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="md:w-48">
            <option value="">All statuses</option>
            <option value="CRITICAL">Critical</option>
            <option value="NEEDS_ATTENTION">Needs attention</option>
            <option value="STABLE">Stable</option>
          </Select>

          <Select value={wardId} onChange={(e) => setWardId(e.target.value)} aria-label="Filter by ward" className="md:w-56">
            <option value="">All wards</option>
            {(wards.data?.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>

          <label className="flex items-center gap-space-2 px-space-3 py-2 rounded-lg bg-surface-container-low cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-secondary"
            />
            <span className="text-body-sm text-on-surface whitespace-nowrap">My patients</span>
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-space-6 py-space-3 border-b border-outline-variant/40 bg-surface-container-low/40">
          <span className="text-label-md text-on-surface-variant font-medium">
            {isLoading ? 'Loading…' : `${meta?.total ?? patients.length} patient${(meta?.total ?? 0) === 1 ? '' : 's'}`}
            {isFetching && !isLoading ? ' · updating' : ''}
          </span>
          {(debouncedQ || status || wardId || mineOnly) ? (
            <button
              onClick={() => { setQ(''); setStatus(''); setWardId(''); setMineOnly(false); router.replace('/patients'); }}
              className="text-label-md text-secondary font-semibold hover:underline flex items-center gap-1"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden /> Clear filters
            </button>
          ) : null}
        </div>

        {isError ? (
          <ErrorState title="Unable to load the patient registry" message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="divide-y divide-outline-variant/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-space-6 py-space-4 flex items-center gap-space-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </div>
            ))}
          </div>
        ) : patients.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title={debouncedQ ? 'No patients match your search' : 'No patients assigned'}
            description={
              debouncedQ
                ? 'Check the spelling, or search by patient number. Records you are not involved in will not appear.'
                : 'Patients appear here once you are their attending clinician, a member of their care team, or a referral gives you access.'
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <table className="w-full hidden lg:table">
              <thead>
                <tr className="text-left border-b border-outline-variant/40">
                  {['Patient', 'Patient number', 'Location', 'Attending', 'Admitted', 'Status'].map((h) => (
                    <th key={h} className="px-space-6 py-space-3 text-label-md font-semibold text-outline uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {patients.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container-low/50 transition-colors group">
                    <td className="px-space-6 py-space-4">
                      <Link href={`/patients/${p.id}`} className="flex items-center gap-space-3 min-w-0">
                        <Avatar name={p.fullName} size="sm" tone={p.status === 'CRITICAL' ? 'critical' : p.status === 'NEEDS_ATTENTION' ? 'attention' : 'neutral'} />
                        <span className="min-w-0">
                          <span className="block text-body-sm font-semibold text-on-surface group-hover:text-secondary truncate">
                            {p.fullName}
                          </span>
                          <span className="block text-label-md text-outline">
                            {p.age} / {genderLabel(p.gender)} · {bloodGroupLabel(p.bloodGroup)}
                            {p.allergies.length ? <span className="text-error"> · Allergies</span> : null}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-space-6 py-space-4 font-mono text-body-sm text-on-surface-variant">{p.patientNumber}</td>
                    <td className="px-space-6 py-space-4 text-body-sm text-on-surface-variant">
                      {p.admission ? (
                        <>
                          {p.admission.wardName ?? 'Unassigned'}
                          {p.admission.bedCode ? <span className="text-outline font-mono"> · {p.admission.bedCode}</span> : null}
                        </>
                      ) : <span className="text-outline">Not admitted</span>}
                    </td>
                    <td className="px-space-6 py-space-4 text-body-sm text-on-surface-variant truncate max-w-[180px]">
                      {p.admission?.attendingDoctorName ?? '—'}
                    </td>
                    <td className="px-space-6 py-space-4 text-body-sm text-outline">
                      {p.admission ? timeAgo(p.admission.admissionDate) : '—'}
                    </td>
                    <td className="px-space-6 py-space-4">
                      <Badge tone={patientStatusTone(p.status)}>
                        {p.status === 'CRITICAL' ? 'Critical' : p.status === 'NEEDS_ATTENTION' ? 'Attention' : 'Stable'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile / tablet cards */}
            <ul className="lg:hidden divide-y divide-outline-variant/30">
              {patients.map((p) => (
                <li key={p.id}>
                  <Link href={`/patients/${p.id}`} className="flex items-start gap-space-3 px-space-4 py-space-4 hover:bg-surface-container-low/50">
                    <Avatar name={p.fullName} tone={p.status === 'CRITICAL' ? 'critical' : p.status === 'NEEDS_ATTENTION' ? 'attention' : 'neutral'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-space-2">
                        <span className="text-body-sm font-semibold text-on-surface truncate">{p.fullName}</span>
                        <Badge tone={patientStatusTone(p.status)}>
                          {p.status === 'CRITICAL' ? 'Critical' : p.status === 'NEEDS_ATTENTION' ? 'Attention' : 'Stable'}
                        </Badge>
                      </div>
                      <p className="text-label-md text-outline font-mono mt-0.5">{p.patientNumber}</p>
                      <p className="text-body-sm text-on-surface-variant mt-1">
                        {p.age} / {genderLabel(p.gender)}
                        {p.admission ? ` · ${p.admission.wardName ?? 'Unassigned'}${p.admission.bedCode ? ` ${p.admission.bedCode}` : ''}` : ' · Not admitted'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {(meta?.totalPages ?? 1) > 1 ? (
              <div className="flex items-center justify-between px-space-6 py-space-4 border-t border-outline-variant/40">
                <span className="text-label-md text-outline">Page {page} of {meta?.totalPages}</span>
                <div className="flex items-center gap-space-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={page >= (meta?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <NewPatientModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => { setNewOpen(false); router.push(`/patients/${id}`); }}
      />
    </div>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const cnHelper = cn;
