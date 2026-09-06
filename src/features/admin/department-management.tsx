'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { adminApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, Textarea,
} from '@/components/ui';

export function DepartmentManagement() {
  const [open, setOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['departments', 'admin'],
    queryFn: () => adminApi.listDepartments(),
  });

  const departments = data?.data ?? [];

  return (
    <div className="space-y-space-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-4">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Departments</h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            The hospital structure that admissions, wards and referrals are organised around.
          </p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Create department</Button>
      </div>

      {isLoading ? <Card><LoadingBlock rows={4} /></Card>
        : isError ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        : departments.length === 0 ? (
          <Card><EmptyState icon={<Building2 className="h-8 w-8" />} title="No departments configured" /></Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-space-4">
            {departments.map((d) => (
              <Card key={d.id} className="p-space-5 space-y-space-2">
                <div className="flex items-start justify-between gap-space-3">
                  <div className="min-w-0">
                    <h2 className="text-body-md font-semibold text-on-surface">{d.name}</h2>
                    <p className="text-label-md text-outline font-mono">{d.code}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge tone={d.isActive ? 'success' : 'muted'}>{d.isActive ? 'Active' : 'Inactive'}</Badge>
                    <Badge tone="muted">{d.isClinical ? 'Clinical' : 'Non-clinical'}</Badge>
                  </div>
                </div>
                {d.description ? <p className="text-body-sm text-on-surface-variant">{d.description}</p> : null}
                <p className="text-label-md text-outline pt-space-2 border-t border-outline-variant/40">
                  {d.staffCount ?? 0} staff member{(d.staffCount ?? 0) === 1 ? '' : 's'}
                </p>
              </Card>
            ))}
          </div>
        )}

      <NewDepartmentModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewDepartmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [issues, setIssues] = React.useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminApi.createDepartment(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      push({ title: 'Department created', tone: 'success' });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setIssues(Object.fromEntries(e.issues.map((i) => [i.field, i.message])));
      showError(e, 'The department could not be created.');
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    mutation.mutate({
      code: String(form.get('code')).trim().toUpperCase(),
      name: String(form.get('name')).trim(),
      description: String(form.get('description') ?? '').trim() || undefined,
      isClinical: form.get('isClinical') === 'on',
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a department"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="dept-form" loading={mutation.isPending}>Create department</Button>
        </>
      }
    >
      <form id="dept-form" onSubmit={submit} className="space-y-space-4" noValidate>
        <div className="grid sm:grid-cols-[140px_1fr] gap-space-4">
          <Field label="Code" htmlFor="code" required error={issues.code}>
            <Input id="code" name="code" required maxLength={12} placeholder="ONCO" className="font-mono uppercase" autoFocus invalid={!!issues.code} />
          </Field>
          <Field label="Name" htmlFor="name" required error={issues.name}>
            <Input id="name" name="name" required placeholder="Oncology" invalid={!!issues.name} />
          </Field>
        </div>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" name="description" rows={3} placeholder="Medical and clinical oncology services." />
        </Field>
        <label className="flex items-center gap-space-2 text-body-sm text-on-surface">
          <input type="checkbox" name="isClinical" defaultChecked className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-secondary" />
          Clinical department (can hold wards and receive referrals)
        </label>
      </form>
    </Modal>
  );
}
