'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { labsApi, radiologyApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast, useErrorToast } from '@/components/providers';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';

const MODALITIES = ['XRAY', 'CT', 'MRI', 'ULTRASOUND', 'OTHER'];

export function OrderInvestigationModal({ open, onClose, patientId, patientName }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string;
}) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [kind, setKind] = React.useState<'LAB' | 'RADIOLOGY'>('LAB');
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const formRef = React.useRef<HTMLFormElement>(null);

  const catalog = useQuery({
    queryKey: ['lab-catalog'],
    queryFn: () => labsApi.catalog('LAB'),
    enabled: open,
    staleTime: 600_000,
  });

  const panels = React.useMemo(() => {
    const set = new Set((catalog.data?.data ?? []).map((c) => c.panel).filter(Boolean) as string[]);
    return [...set].sort();
  }, [catalog.data]);

  const onDone = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    push({ title: message, tone: 'success' });
    formRef.current?.reset();
    onClose();
  };

  const onFail = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
    showError(err, fallback);
  };

  const labMutation = useMutation({
    mutationFn: (payload: { panel: string; clinicalInfo?: string; priority?: string }) =>
      labsApi.createOrder({ patientId, ...payload }),
    onSuccess: () => onDone('Laboratory order sent to pathology'),
    onError: (e) => onFail(e, 'The laboratory order could not be raised.'),
  });

  const radMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => radiologyApi.createStudy({ patientId, ...payload }),
    onSuccess: () => onDone('Imaging request sent to radiology'),
    onError: (e) => onFail(e, 'The imaging request could not be raised.'),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    const clinicalInfo = String(form.get('clinicalInfo') ?? '').trim() || undefined;
    const priority = String(form.get('priority') ?? 'ROUTINE');

    if (kind === 'LAB') {
      labMutation.mutate({ panel: String(form.get('panel')).trim(), clinicalInfo, priority });
    } else {
      radMutation.mutate({
        modality: String(form.get('modality')),
        bodyPart: String(form.get('bodyPart')).trim(),
        description: String(form.get('description')).trim(),
        contrastUsed: form.get('contrastUsed') === 'on',
        clinicalInfo,
        priority,
      });
    }
  }

  const pending = labMutation.isPending || radMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Order an investigation"
      description={`Raised for ${patientName}. The receiving department sees it on their worklist immediately.`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="order-form" loading={pending}>
            {kind === 'LAB' ? 'Send to pathology' : 'Send to radiology'}
          </Button>
        </>
      }
    >
      <form id="order-form" ref={formRef} onSubmit={submit} className="space-y-space-5" noValidate>
        <div className="flex items-center gap-space-2" role="tablist" aria-label="Investigation type">
          {(['LAB', 'RADIOLOGY'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => { setKind(k); setIssues({}); }}
              className={cn('px-space-4 py-2 rounded-xl text-body-sm font-semibold transition-colors',
                kind === k ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high')}
            >
              {k === 'LAB' ? 'Pathology' : 'Imaging'}
            </button>
          ))}
        </div>

        {kind === 'LAB' ? (
          <Field label="Panel" htmlFor="panel" required error={issues.panel} hint="Choose a standard panel or type a custom request.">
            <Input id="panel" name="panel" required list="lab-panels" placeholder="Full Blood Count" invalid={!!issues.panel} autoFocus />
            <datalist id="lab-panels">
              {panels.map((p) => <option key={p} value={p} />)}
            </datalist>
          </Field>
        ) : (
          <div className="space-y-space-4">
            <div className="grid sm:grid-cols-2 gap-space-4">
              <Field label="Modality" htmlFor="modality" required error={issues.modality}>
                <Select id="modality" name="modality" required defaultValue="XRAY">
                  {MODALITIES.map((m) => <option key={m} value={m}>{m === 'XRAY' ? 'X-Ray' : m}</option>)}
                </Select>
              </Field>
              <Field label="Body part" htmlFor="bodyPart" required error={issues.bodyPart}>
                <Input id="bodyPart" name="bodyPart" required placeholder="Chest" invalid={!!issues.bodyPart} />
              </Field>
            </div>
            <Field label="Study description" htmlFor="description" required error={issues.description}>
              <Input id="description" name="description" required placeholder="PA chest radiograph" invalid={!!issues.description} />
            </Field>
            <label className="flex items-center gap-space-2 text-body-sm text-on-surface">
              <input type="checkbox" name="contrastUsed" className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-secondary" />
              Contrast required
            </label>
          </div>
        )}

        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue="ROUTINE">
            <option value="ROUTINE">Routine</option>
            <option value="URGENT">Urgent</option>
            <option value="STAT">STAT</option>
          </Select>
        </Field>

        <Field label="Clinical information" htmlFor="clinicalInfo" hint="What question are you asking? This reaches the reporting clinician.">
          <Textarea id="clinicalInfo" name="clinicalInfo" rows={3} placeholder="Ongoing chest pain, troponin rising. Query acute coronary syndrome." />
        </Field>
      </form>
    </Modal>
  );
}
