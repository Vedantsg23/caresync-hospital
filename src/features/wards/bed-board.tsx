'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Building2, Plus } from 'lucide-react';
import { wardsApi, departmentsApi } from '@/lib/api/endpoints';
import { useAuth, useToast, useErrorToast } from '@/components/providers';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  Select, StatTile,
} from '@/components/ui';
import { cn, titleCase } from '@/lib/utils';
import { PERMISSIONS } from '@/types/rbac';

const BED_TONES: Record<string, string> = {
  AVAILABLE: 'bg-tertiary-fixed/35 border-tertiary-fixed-dim text-on-tertiary-fixed-variant',
  OCCUPIED: 'bg-secondary-fixed/50 border-secondary-fixed-dim text-on-secondary-fixed-variant',
  CLEANING: 'bg-warning-container/70 border-warning/30 text-on-warning-container',
  RESERVED: 'bg-surface-container-high border-outline-variant text-on-surface-variant',
};

export function BedBoard() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { push } = useToast();
  const showError = useErrorToast();

  const [wardId, setWardId] = React.useState('');
  const [newWardOpen, setNewWardOpen] = React.useState(false);

  const wards = useQuery({ queryKey: ['wards'], queryFn: () => wardsApi.list() });
  const beds = useQuery({ queryKey: ['beds', wardId], queryFn: () => wardsApi.beds(wardId || undefined) });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => wardsApi.setBedStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beds'] });
      queryClient.invalidateQueries({ queryKey: ['wards'] });
      push({ title: 'Bed updated', tone: 'success' });
    },
    onError: (e) => showError(e, 'The bed could not be updated.'),
  });

  const wardList = wards.data?.data ?? [];
  const bedList = React.useMemo(() => beds.data?.data ?? [], [beds.data]);

  const totals = React.useMemo(() => ({
    total: bedList.length,
    occupied: bedList.filter((b) => b.status === 'OCCUPIED').length,
    available: bedList.filter((b) => b.status === 'AVAILABLE').length,
    cleaning: bedList.filter((b) => b.status === 'CLEANING').length,
  }), [bedList]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, typeof bedList>();
    bedList.forEach((b) => {
      if (!map.has(b.wardName)) map.set(b.wardName, []);
      map.get(b.wardName)!.push(b);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [bedList]);

  return (
    <div className="space-y-space-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-4">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Wards &amp; beds</h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            Live bed board across the hospital. Occupancy follows admissions, transfers and discharges automatically.
          </p>
        </div>
        {can(PERMISSIONS.WARD_MANAGE) ? (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewWardOpen(true)}>Create ward</Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-4">
        <StatTile label="Total beds" value={totals.total} icon={<BedDouble className="h-5 w-5" />} />
        <StatTile label="Occupied" value={totals.occupied} />
        <StatTile label="Available" value={totals.available} tone={totals.available === 0 ? 'critical' : 'neutral'} />
        <StatTile label="Turnaround" value={totals.cleaning} tone={totals.cleaning > 0 ? 'attention' : 'neutral'} />
      </div>

      <Card className="p-space-4">
        <Field label="Ward" htmlFor="ward-filter" className="max-w-sm">
          <Select id="ward-filter" value={wardId} onChange={(e) => setWardId(e.target.value)}>
            <option value="">All wards</option>
            {wardList.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} — {w.occupiedBeds}/{w.totalBeds} occupied
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {beds.isLoading ? (
        <Card><LoadingBlock rows={4} /></Card>
      ) : beds.isError ? (
        <ErrorState message={(beds.error as Error)?.message} onRetry={() => beds.refetch()} />
      ) : bedList.length === 0 ? (
        <Card>
          <EmptyState icon={<BedDouble className="h-8 w-8" />} title="No beds configured"
            description="An administrator can create wards and beds from this screen." />
        </Card>
      ) : (
        <div className="space-y-space-6">
          {grouped.map(([ward, wardBeds]) => (
            <Card key={ward} className="overflow-hidden">
              <div className="flex items-center justify-between gap-space-4 px-space-6 py-space-4 border-b border-outline-variant/40">
                <div>
                  <h2 className="text-headline-sm text-on-surface font-semibold">{ward}</h2>
                  <p className="text-label-md text-outline">{wardBeds[0]?.departmentName}</p>
                </div>
                <div className="flex items-center gap-space-2 text-label-md">
                  <Badge tone="success">{wardBeds.filter((b) => b.status === 'AVAILABLE').length} available</Badge>
                  <Badge tone="info">{wardBeds.filter((b) => b.status === 'OCCUPIED').length} occupied</Badge>
                </div>
              </div>

              <div className="p-space-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-space-3">
                {wardBeds.map((b) => (
                  <div key={b.id} className={cn('rounded-xl border p-space-3 space-y-space-2', BED_TONES[b.status])}>
                    <div className="flex items-center justify-between gap-space-2">
                      <span className="font-mono text-label-md font-semibold">{b.code}</span>
                      <span className="text-label-sm uppercase tracking-wider font-semibold opacity-80">
                        {titleCase(b.status)}
                      </span>
                    </div>

                    {b.patientId ? (
                      <Link href={`/patients/${b.patientId}`} className="block group">
                        <span className="block text-body-sm font-semibold truncate group-hover:underline">{b.patientName}</span>
                        <span className="block text-label-md font-mono opacity-75">{b.patientNumber}</span>
                      </Link>
                    ) : (
                      <p className="text-body-sm opacity-70">Unoccupied</p>
                    )}

                    {can(PERMISSIONS.WARD_MANAGE) && b.status !== 'OCCUPIED' ? (
                      <Select
                        aria-label={`Status for bed ${b.code}`}
                        value={b.status}
                        onChange={(e) => setStatus.mutate({ id: b.id, status: e.target.value })}
                        className="text-label-md py-1"
                      >
                        <option value="AVAILABLE">Available</option>
                        <option value="CLEANING">Cleaning</option>
                        <option value="RESERVED">Reserved</option>
                      </Select>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewWardModal open={newWardOpen} onClose={() => setNewWardOpen(false)} />
    </div>
  );
}

function NewWardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.list(), enabled: open });

  const mutation = useMutation({
    mutationFn: async (payload: { code: string; name: string; departmentId: string; floor?: string; isCritical: boolean; bedCount: number }) => {
      const { data: ward } = await wardsApi.create({
        code: payload.code, name: payload.name, departmentId: payload.departmentId,
        floor: payload.floor, isCritical: payload.isCritical,
      });
      for (let i = 1; i <= payload.bedCount; i++) {
        await wardsApi.createBed({ wardId: ward.id, code: `${payload.code}-${String(i).padStart(2, '0')}` });
      }
      return ward;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wards'] });
      queryClient.invalidateQueries({ queryKey: ['beds'] });
      push({ title: 'Ward created', tone: 'success' });
      onClose();
    },
    onError: (e) => showError(e, 'The ward could not be created.'),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    mutation.mutate({
      code: String(form.get('code')).trim().toUpperCase(),
      name: String(form.get('name')).trim(),
      departmentId: String(form.get('departmentId')),
      floor: String(form.get('floor') ?? '').trim() || undefined,
      isCritical: form.get('isCritical') === 'on',
      bedCount: Math.min(60, Math.max(0, Number(form.get('bedCount') ?? 0))),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a ward"
      description="Beds are created automatically, numbered from the ward code."
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="ward-form" loading={mutation.isPending}>Create ward</Button>
        </>
      }
    >
      <form id="ward-form" onSubmit={submit} className="space-y-space-4" noValidate>
        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Ward code" htmlFor="code" required hint="Used as the bed prefix, e.g. ICU-01.">
            <Input id="code" name="code" required maxLength={12} placeholder="CARD-B" autoFocus className="font-mono uppercase" />
          </Field>
          <Field label="Ward name" htmlFor="name" required>
            <Input id="name" name="name" required placeholder="Cardiology Ward B" />
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-space-4">
          <Field label="Department" htmlFor="departmentId" required className="sm:col-span-2">
            <Select id="departmentId" name="departmentId" required defaultValue="">
              <option value="" disabled>Select department</option>
              {(departments.data?.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Floor" htmlFor="floor">
            <Input id="floor" name="floor" placeholder="2" />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-space-4 items-end">
          <Field label="Number of beds" htmlFor="bedCount" hint="Up to 60.">
            <Input id="bedCount" name="bedCount" type="number" min={0} max={60} defaultValue={12} />
          </Field>
          <label className="flex items-center gap-space-2 text-body-sm text-on-surface pb-2">
            <input type="checkbox" name="isCritical" className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-secondary" />
            Critical care ward
          </label>
        </div>
      </form>
    </Modal>
  );
}

export const WardIcon = Building2;
