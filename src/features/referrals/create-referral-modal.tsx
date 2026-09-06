'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles } from 'lucide-react';
import { referralsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { cn, vitalsSummary } from '@/lib/utils';
import type { PatientHeaderDto, SpecialistDto } from '@/types/api';

/**
 * Referral composer.
 *
 * Pre-fills the clinical context from the patient record so the receiving
 * specialist gets a complete picture without the referrer retyping it — which
 * is the whole point of the connected record.
 */
export function CreateReferralModal({ open, onClose, patient }: {
  open: boolean; onClose: () => void; patient: PatientHeaderDto;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();

  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const [specialistId, setSpecialistId] = React.useState('');
  const formRef = React.useRef<HTMLFormElement>(null);

  const specialists = useQuery({
    queryKey: ['specialists'],
    queryFn: () => referralsApi.specialists(),
    enabled: open,
    staleTime: 300_000,
  });

  const byDepartment = React.useMemo(() => {
    const groups = new Map<string, SpecialistDto[]>();
    (specialists.data?.data ?? []).forEach((s) => {
      const key = s.departmentName ?? 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [specialists.data]);

  const selected = (specialists.data?.data ?? []).find((s) => s.id === specialistId);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => referralsApi.create(payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['patient', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      push({
        title: `Referral ${data.referralNumber} sent`,
        description: `${selected?.fullName ?? 'The specialist'} has been notified and can now see this patient's record.`,
        tone: 'success',
      });
      formRef.current?.reset();
      setSpecialistId('');
      onClose();
      router.push(`/referrals/${data.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      showError(err, 'The referral could not be created.');
    },
  });

  /** Composes the clinical context the specialist needs, from the live record. */
  const prefill = React.useMemo(() => {
    const meds = patient.activeMedications.length
      ? patient.activeMedications.map((m) => `${m.medicineName} ${m.dose} ${m.frequency} (${m.route.toLowerCase()})`).join('\n')
      : 'No active medication recorded.';

    const history = [
      patient.chronicConditions.length ? `Background: ${patient.chronicConditions.join(', ')}.` : null,
      patient.allergies.length ? `Allergies: ${patient.allergies.join(', ')}.` : 'No known drug allergies.',
    ].filter(Boolean).join(' ');

    const summary = [
      `${patient.age}-year-old ${patient.gender.toLowerCase()} patient, ${patient.patientNumber}.`,
      patient.admission ? `Admitted ${new Date(patient.admission.admissionDate).toLocaleDateString()} under ${patient.admission.attendingDoctorName ?? 'the medical team'} for ${patient.admission.reason.toLowerCase()}.` : 'Not currently admitted.',
      patient.admission?.wardName ? `Currently in ${patient.admission.wardName}${patient.admission.bedCode ? `, bed ${patient.admission.bedCode}` : ''}.` : null,
      patient.latestVitals ? `Most recent observations: ${vitalsSummary(patient.latestVitals)}.` : null,
    ].filter(Boolean).join(' ');

    return { meds, history, summary };
  }, [patient]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? '').trim();

    mutation.mutate({
      patientId: patient.id,
      specialistDoctorId: text('specialistDoctorId'),
      reason: text('reason'),
      clinicalSummary: text('clinicalSummary'),
      symptoms: text('symptoms') || undefined,
      relevantHistory: text('relevantHistory') || undefined,
      relevantInvestigations: text('relevantInvestigations') || undefined,
      currentMedications: text('currentMedications') || undefined,
      priority: text('priority') || 'ROUTINE',
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refer to a specialist"
      description={`${patient.fullName} · ${patient.patientNumber}. Accepting this referral gives the specialist scoped access to the record.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="referral-form" loading={mutation.isPending} icon={<Send className="h-4 w-4" />}>
            Send referral
          </Button>
        </>
      }
    >
      <form id="referral-form" ref={formRef} onSubmit={submit} className="space-y-space-5" noValidate>
        <div className="flex items-start gap-space-2 px-space-3 py-space-2 rounded-lg bg-secondary-fixed/40 text-on-secondary-fixed-variant">
          <Sparkles className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <p className="text-body-sm">
            The clinical context below has been drafted from this patient&apos;s live record.
            Review and edit it before sending — you are the author.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Specialist" htmlFor="specialistDoctorId" required error={issues.specialistDoctorId}>
            <Select
              id="specialistDoctorId"
              name="specialistDoctorId"
              required
              value={specialistId}
              onChange={(e) => setSpecialistId(e.target.value)}
              invalid={!!issues.specialistDoctorId}
            >
              <option value="" disabled>Select a specialist</option>
              {specialists.isLoading ? <option disabled>Loading…</option> : null}
              {byDepartment.map(([dept, list]) => (
                <optgroup key={dept} label={dept}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}{s.specialization ? ` — ${s.specialization}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="priority" hint="Emergency and urgent referrals are escalated on the specialist's inbox.">
            <Select id="priority" name="priority" defaultValue="ROUTINE">
              <option value="ROUTINE">Routine</option>
              <option value="URGENT">Urgent</option>
              <option value="EMERGENCY">Emergency</option>
            </Select>
          </Field>
        </div>

        {selected ? (
          <p className={cn('text-body-sm px-space-3 py-space-2 rounded-lg bg-surface-container-low text-on-surface-variant')}>
            Referring to <strong className="text-on-surface font-semibold">{selected.fullName}</strong>
            {selected.designation ? `, ${selected.designation}` : ''}
            {selected.departmentName ? ` in ${selected.departmentName}` : ''}.
          </p>
        ) : null}

        <Field label="Reason for referral" htmlFor="reason" required error={issues.reason}>
          <Input id="reason" name="reason" required maxLength={500}
            placeholder="Persistent chest pain and abnormal ECG" invalid={!!issues.reason} />
        </Field>

        <Field label="Clinical summary" htmlFor="clinicalSummary" required error={issues.clinicalSummary}
          hint="The specialist reads this first. Drafted from the record — edit freely.">
          <Textarea id="clinicalSummary" name="clinicalSummary" required rows={5}
            defaultValue={prefill.summary} invalid={!!issues.clinicalSummary} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Presenting symptoms" htmlFor="symptoms">
            <Textarea id="symptoms" name="symptoms" rows={3}
              placeholder="Central chest heaviness radiating to the left arm, worse on exertion." />
          </Field>
          <Field label="Relevant history" htmlFor="relevantHistory">
            <Textarea id="relevantHistory" name="relevantHistory" rows={3} defaultValue={prefill.history} />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Relevant investigations" htmlFor="relevantInvestigations"
            hint="Results the specialist should see before reviewing.">
            <Textarea id="relevantInvestigations" name="relevantInvestigations" rows={3}
              placeholder="Troponin I 780 ng/L (peak). CT coronary angiogram: 70 per cent proximal LAD stenosis." />
          </Field>
          <Field label="Current medications" htmlFor="currentMedications">
            <Textarea id="currentMedications" name="currentMedications" rows={3} defaultValue={prefill.meds} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
