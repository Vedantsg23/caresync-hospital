'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patientsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';

const BLOOD_GROUPS = [
  ['UNKNOWN', 'Unknown'], ['A_POSITIVE', 'A+'], ['A_NEGATIVE', 'A-'],
  ['B_POSITIVE', 'B+'], ['B_NEGATIVE', 'B-'], ['AB_POSITIVE', 'AB+'],
  ['AB_NEGATIVE', 'AB-'], ['O_POSITIVE', 'O+'], ['O_NEGATIVE', 'O-'],
] as const;

export function NewPatientModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [issues, setIssues] = React.useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => patientsApi.create(payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      push({ title: 'Patient registered', description: `Assigned patient number ${data.patientNumber}.`, tone: 'success' });
      onCreated(data.id);
    },
    onError: (err) => {
      if (err instanceof ApiError) setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      showError(err, 'The patient could not be registered.');
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    const value = (k: string) => String(form.get(k) ?? '').trim();
    const list = (k: string) => value(k).split(',').map((s) => s.trim()).filter(Boolean);

    const contactName = value('contactName');
    mutation.mutate({
      firstName: value('firstName'),
      lastName: value('lastName'),
      dateOfBirth: value('dateOfBirth'),
      gender: value('gender'),
      bloodGroup: value('bloodGroup'),
      phone: value('phone') || undefined,
      email: value('email') || undefined,
      addressLine: value('addressLine') || undefined,
      city: value('city') || undefined,
      allergies: list('allergies'),
      chronicConditions: list('chronicConditions'),
      emergencyContact: contactName
        ? { name: contactName, relationship: value('contactRelationship') || 'Next of kin', phone: value('contactPhone') }
        : undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register a patient"
      description="Creates the master patient record. Use demonstration data only."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" form="new-patient-form" loading={mutation.isPending}>Register patient</Button>
        </>
      }
    >
      <form id="new-patient-form" onSubmit={submit} className="space-y-space-6" noValidate>
        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="First name" htmlFor="firstName" required error={issues.firstName}>
            <Input id="firstName" name="firstName" required autoFocus invalid={!!issues.firstName} />
          </Field>
          <Field label="Last name" htmlFor="lastName" required error={issues.lastName}>
            <Input id="lastName" name="lastName" required invalid={!!issues.lastName} />
          </Field>
          <Field label="Date of birth" htmlFor="dateOfBirth" required error={issues.dateOfBirth}>
            <Input id="dateOfBirth" name="dateOfBirth" type="date" required max={new Date().toISOString().slice(0, 10)} invalid={!!issues.dateOfBirth} />
          </Field>
          <Field label="Gender" htmlFor="gender" required error={issues.gender}>
            <Select id="gender" name="gender" required defaultValue="">
              <option value="" disabled>Select</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
              <option value="UNKNOWN">Not stated</option>
            </Select>
          </Field>
          <Field label="Blood group" htmlFor="bloodGroup">
            <Select id="bloodGroup" name="bloodGroup" defaultValue="UNKNOWN">
              {BLOOD_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="phone" error={issues.phone}>
            <Input id="phone" name="phone" type="tel" placeholder="+91 98765 43210" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Email" htmlFor="email" error={issues.email}>
            <Input id="email" name="email" type="email" invalid={!!issues.email} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" />
          </Field>
        </div>

        <Field label="Address" htmlFor="addressLine">
          <Input id="addressLine" name="addressLine" />
        </Field>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Allergies" htmlFor="allergies" hint="Comma separated. Blocks conflicting prescriptions.">
            <Textarea id="allergies" name="allergies" rows={2} placeholder="Penicillin, Latex" className="min-h-0" />
          </Field>
          <Field label="Chronic conditions" htmlFor="chronicConditions" hint="Comma separated.">
            <Textarea id="chronicConditions" name="chronicConditions" rows={2} placeholder="Hypertension, Type 2 diabetes" className="min-h-0" />
          </Field>
        </div>

        <fieldset className="border-t border-outline-variant/60 pt-space-4">
          <legend className="sr-only">Emergency contact</legend>
          <p className="text-label-md uppercase tracking-wider text-outline font-semibold mb-space-3">Emergency contact</p>
          <div className="grid sm:grid-cols-3 gap-space-4">
            <Field label="Name" htmlFor="contactName">
              <Input id="contactName" name="contactName" />
            </Field>
            <Field label="Relationship" htmlFor="contactRelationship">
              <Input id="contactRelationship" name="contactRelationship" placeholder="Spouse" />
            </Field>
            <Field label="Phone" htmlFor="contactPhone">
              <Input id="contactPhone" name="contactPhone" type="tel" />
            </Field>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
