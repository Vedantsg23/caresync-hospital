'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vitalsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { Button, Field, Input, Modal, Textarea } from '@/components/ui';

const FIELDS = [
  { name: 'bloodPressureSystolic', label: 'Systolic BP', unit: 'mmHg', min: 40, max: 300, step: '1' },
  { name: 'bloodPressureDiastolic', label: 'Diastolic BP', unit: 'mmHg', min: 20, max: 220, step: '1' },
  { name: 'heartRate', label: 'Heart rate', unit: 'bpm', min: 10, max: 300, step: '1' },
  { name: 'spo2', label: 'SpO2', unit: '%', min: 30, max: 100, step: '1' },
  { name: 'respiratoryRate', label: 'Respiratory rate', unit: 'per min', min: 2, max: 80, step: '1' },
  { name: 'temperatureC', label: 'Temperature', unit: 'deg C', min: 25, max: 45, step: '0.1' },
  { name: 'bloodGlucose', label: 'Blood glucose', unit: 'mmol/L', min: 0.5, max: 60, step: '0.1' },
  { name: 'painScore', label: 'Pain score', unit: '0 to 10', min: 0, max: 10, step: '1' },
] as const;

/** Nursing observation entry, optimised for fast bedside use on a tablet. */
export function RecordVitalsModal({ open, onClose, patientId, patientName }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string;
}) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const formRef = React.useRef<HTMLFormElement>(null);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => vitalsApi.create(patientId, payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const score = data.assessment?.score ?? data.newsScore ?? 0;
      push({
        title: 'Observations recorded',
        description: score >= 3
          ? `Early-warning score ${score}. The attending clinician has been alerted.`
          : `Early-warning score ${score}. Within the expected range.`,
        tone: score >= 6 ? 'error' : 'success',
      });
      formRef.current?.reset();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      showError(err, 'The observations could not be saved.');
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    FIELDS.forEach((f) => {
      const raw = String(form.get(f.name) ?? '').trim();
      if (raw !== '') payload[f.name] = Number(raw);
    });
    const notes = String(form.get('notes') ?? '').trim();
    if (notes) payload.notes = notes;
    mutation.mutate(payload);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record observations"
      description={`New observation set for ${patientName}. Leave any measurement blank if it was not taken.`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="vitals-form" loading={mutation.isPending}>Save observations</Button>
        </>
      }
    >
      <form id="vitals-form" ref={formRef} onSubmit={submit} className="space-y-space-5" noValidate>
        {issues['(root)'] ? (
          <p className="text-body-sm text-on-error-container bg-error-container px-space-3 py-space-2 rounded-lg">
            {issues['(root)']}
          </p>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-4">
          {FIELDS.map((f) => (
            <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.unit} error={issues[f.name]}>
              <Input
                id={f.name}
                name={f.name}
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step}
                placeholder="-"
                className="font-mono"
                invalid={!!issues[f.name]}
              />
            </Field>
          ))}
        </div>

        <Field label="Notes" htmlFor="notes" hint="Anything the next clinician should know about this set.">
          <Textarea id="notes" name="notes" rows={3} placeholder="Patient reports feeling short of breath on exertion." />
        </Field>
      </form>
    </Modal>
  );
}
