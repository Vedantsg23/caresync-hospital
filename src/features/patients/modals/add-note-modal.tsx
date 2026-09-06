'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useAuth, useToast, useErrorToast } from '@/components/providers';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';

const ALL_TYPES = [
  { value: 'PROGRESS', label: 'Progress note' },
  { value: 'CONSULTATION', label: 'Consultation note' },
  { value: 'ADMISSION', label: 'Admission note' },
  { value: 'NURSING', label: 'Nursing note' },
  { value: 'SPECIALIST', label: 'Specialist note' },
  { value: 'DISCHARGE', label: 'Discharge note' },
];

export function AddNoteModal({ open, onClose, patientId, patientName }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { push } = useToast();
  const showError = useErrorToast();
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const formRef = React.useRef<HTMLFormElement>(null);

  // Nursing staff may only author nursing notes; enforced server-side too.
  const types = user?.role === 'NURSE' ? ALL_TYPES.filter((t) => t.value === 'NURSING') : ALL_TYPES;

  const mutation = useMutation({
    mutationFn: (payload: { noteType: string; title: string; content: string }) => notesApi.create(patientId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      push({ title: 'Note added to the record', tone: 'success' });
      formRef.current?.reset();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      showError(err, 'The note could not be saved.');
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    mutation.mutate({
      noteType: String(form.get('noteType')),
      title: String(form.get('title')).trim(),
      content: String(form.get('content')).trim(),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a clinical note"
      description={`Recorded against ${patientName}, attributed to you and timestamped. Notes are versioned, never overwritten.`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="note-form" loading={mutation.isPending}>Save note</Button>
        </>
      }
    >
      <form id="note-form" ref={formRef} onSubmit={submit} className="space-y-space-4" noValidate>
        <div className="grid sm:grid-cols-[200px_1fr] gap-space-4">
          <Field label="Note type" htmlFor="noteType" required error={issues.noteType}>
            <Select id="noteType" name="noteType" required defaultValue={types[0]?.value}>
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Title" htmlFor="title" required error={issues.title}>
            <Input id="title" name="title" required placeholder="Consultant ward round" invalid={!!issues.title} autoFocus />
          </Field>
        </div>

        <Field
          label="Note"
          htmlFor="content"
          required
          error={issues.content}
          hint="Use clear headings such as ASSESSMENT, FINDINGS and PLAN so colleagues can scan the note quickly."
        >
          <Textarea id="content" name="content" required rows={12} invalid={!!issues.content}
            placeholder={'ASSESSMENT\n\nFINDINGS\n\nPLAN\n'} />
        </Field>
      </form>
    </Modal>
  );
}
