'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { pharmacyApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { isoDateInput } from '@/lib/utils';

const ROUTES = ['ORAL', 'IV', 'IM', 'SUBCUTANEOUS', 'TOPICAL', 'INHALATION', 'SUBLINGUAL', 'RECTAL', 'OTHER'];
const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every 6 hours', 'Every 8 hours', 'As required', 'Once weekly'];

export function PrescribeModal({ open, onClose, patientId, patientName, allergies }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string; allergies: string[];
}) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const [conflict, setConflict] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const formulary = useQuery({
    queryKey: ['formulary'],
    queryFn: () => pharmacyApi.formulary(),
    enabled: open,
    staleTime: 600_000,
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => pharmacyApi.prescribe({ patientId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      push({ title: 'Prescription sent to pharmacy', description: 'It appears on the dispensing worklist immediately.', tone: 'success' });
      formRef.current?.reset();
      setConflict(null);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
        if (err.code === 'CONFLICT') { setConflict(err.message); return; }
      }
      showError(err, 'The prescription could not be created.');
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    setConflict(null);
    const form = new FormData(e.currentTarget);
    const endDate = String(form.get('endDate') ?? '').trim();
    mutation.mutate({
      medicineName: String(form.get('medicineName')).trim(),
      dose: String(form.get('dose')).trim(),
      frequency: String(form.get('frequency')).trim(),
      route: String(form.get('route')),
      instructions: String(form.get('instructions') ?? '').trim() || undefined,
      startDate: String(form.get('startDate')),
      endDate: endDate || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Prescribe a medicine"
      description={`Prescribed for ${patientName}. Pharmacy receives it for dispensing.`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="prescribe-form" loading={mutation.isPending}>Send to pharmacy</Button>
        </>
      }
    >
      <form id="prescribe-form" ref={formRef} onSubmit={submit} className="space-y-space-4" noValidate>
        {allergies.length > 0 ? (
          <div className="flex items-start gap-space-2 px-space-3 py-space-2 rounded-lg bg-error-container text-on-error-container">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <p className="text-body-sm">
              <strong className="font-semibold">Recorded allergies:</strong> {allergies.join(', ')}.
              A prescription matching one of these is rejected by the server.
            </p>
          </div>
        ) : null}

        {conflict ? (
          <div role="alert" className="flex items-start gap-space-2 px-space-3 py-space-2 rounded-lg bg-error text-on-error">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <p className="text-body-sm font-medium">{conflict}</p>
          </div>
        ) : null}

        <Field label="Medicine" htmlFor="medicineName" required error={issues.medicineName} hint="Start typing to search the formulary.">
          <Input id="medicineName" name="medicineName" required list="formulary" placeholder="Aspirin 75 mg" invalid={!!issues.medicineName} autoFocus />
          <datalist id="formulary">
            {(formulary.data?.data ?? []).map((m) => (
              <option key={m.id} value={`${m.name}${m.strength ? ` ${m.strength}` : ''}`} />
            ))}
          </datalist>
        </Field>

        <div className="grid sm:grid-cols-3 gap-space-4">
          <Field label="Dose" htmlFor="dose" required error={issues.dose}>
            <Input id="dose" name="dose" required placeholder="75 mg" invalid={!!issues.dose} />
          </Field>
          <Field label="Frequency" htmlFor="frequency" required error={issues.frequency}>
            <Input id="frequency" name="frequency" required list="frequencies" placeholder="Once daily" invalid={!!issues.frequency} />
            <datalist id="frequencies">
              {FREQUENCIES.map((f) => <option key={f} value={f} />)}
            </datalist>
          </Field>
          <Field label="Route" htmlFor="route" required error={issues.route}>
            <Select id="route" name="route" required defaultValue="ORAL">
              {ROUTES.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Start date" htmlFor="startDate" required error={issues.startDate}>
            <Input id="startDate" name="startDate" type="date" required defaultValue={isoDateInput()} invalid={!!issues.startDate} />
          </Field>
          <Field label="End date" htmlFor="endDate" hint="Leave blank for an ongoing medicine." error={issues.endDate}>
            <Input id="endDate" name="endDate" type="date" invalid={!!issues.endDate} />
          </Field>
        </div>

        <Field label="Instructions" htmlFor="instructions">
          <Textarea id="instructions" name="instructions" rows={2} placeholder="Take with food. Review after seven days." />
        </Field>
      </form>
    </Modal>
  );
}
