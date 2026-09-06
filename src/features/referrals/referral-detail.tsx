'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Check, X, HelpCircle, FileCheck2, ShieldAlert, ExternalLink,
  Stethoscope, ClipboardCheck, MessageSquareReply, CircleCheck,
} from 'lucide-react';
import { referralsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useAuth, useToast, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Avatar, Badge, Button, Card, DataRow, ErrorState, Field, LoadingBlock, Modal,
  Textarea, priorityTone, referralStatusTone,
} from '@/components/ui';
import { calculateAge, cn, formatDateTime, genderLabel, timeAgo, titleCase } from '@/lib/utils';
import type { ReferralDetailDto } from '@/types/api';

/** The visible state machine, so a clinician can see where a referral stands. */
const STAGES = [
  { key: 'created', label: 'Referral raised', icon: ClipboardCheck },
  { key: 'accepted', label: 'Accepted by specialist', icon: Check },
  { key: 'responded', label: 'Specialist response', icon: MessageSquareReply },
  { key: 'completed', label: 'Completed', icon: CircleCheck },
] as const;

export function ReferralDetail({ referralId }: { referralId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();

  const [respondOpen, setRespondOpen] = React.useState(false);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [answerOpen, setAnswerOpen] = React.useState(false);
  const [issues, setIssues] = React.useState<Record<string, string>>({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['referral', referralId],
    queryFn: () => referralsApi.get(referralId),
    refetchInterval: 30_000,
  });

  const referral = data?.data;
  useRealtime({ patientId: referral?.patientId, enabled: !!referral });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['referral', referralId] });
    queryClient.invalidateQueries({ queryKey: ['referrals'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    if (referral) queryClient.invalidateQueries({ queryKey: ['patient', referral.patientId] });
  };

  const onFail = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
    showError(err, fallback);
  };

  const accept = useMutation({
    mutationFn: () => referralsApi.accept(referralId),
    onSuccess: () => {
      invalidate();
      push({
        title: 'Referral accepted',
        description: 'You now have access to this patient’s record, and the referring doctor has been notified.',
        tone: 'success',
      });
    },
    onError: (e) => onFail(e, 'The referral could not be accepted.'),
  });

  const decline = useMutation({
    mutationFn: (reason: string) => referralsApi.decline(referralId, reason),
    onSuccess: () => { invalidate(); setDeclineOpen(false); push({ title: 'Referral declined', tone: 'info' }); },
    onError: (e) => onFail(e, 'The referral could not be declined.'),
  });

  const requestInfo = useMutation({
    mutationFn: (question: string) => referralsApi.requestInformation(referralId, question),
    onSuccess: () => { invalidate(); setInfoOpen(false); push({ title: 'Information requested', description: 'The referring doctor has been notified.', tone: 'success' }); },
    onError: (e) => onFail(e, 'The request could not be sent.'),
  });

  const provideInfo = useMutation({
    mutationFn: (answer: string) => referralsApi.provideInformation(referralId, answer),
    onSuccess: () => { invalidate(); setAnswerOpen(false); push({ title: 'Information supplied', description: 'The referral is back with the specialist.', tone: 'success' }); },
    onError: (e) => onFail(e, 'The response could not be sent.'),
  });

  const respond = useMutation({
    mutationFn: (payload: { assessment: string; findings: string; recommendations: string; treatmentPlan: string; followUp?: string }) =>
      referralsApi.respond(referralId, payload),
    onSuccess: () => {
      invalidate();
      setRespondOpen(false);
      push({
        title: 'Specialist response recorded',
        description: 'It is now on the patient chart and the referring doctor has been notified.',
        tone: 'success',
      });
    },
    onError: (e) => onFail(e, 'The response could not be saved.'),
  });

  const complete = useMutation({
    mutationFn: () => referralsApi.complete(referralId),
    onSuccess: () => { invalidate(); push({ title: 'Referral completed', description: 'The loop is closed and the referring doctor has been notified.', tone: 'success' }); },
    onError: (e) => onFail(e, 'The referral could not be completed.'),
  });

  if (isLoading) return <Card><LoadingBlock rows={6} /></Card>;

  if (isError || !referral) {
    return (
      <ErrorState
        title="Referral unavailable"
        message={(error as Error)?.message ?? 'This referral could not be found, or you are not party to it.'}
        onRetry={() => refetch()}
      />
    );
  }

  const r: ReferralDetailDto = referral;
  const isSpecialist = r.specialistDoctorId === user?.id;
  const isReferrer = r.referringDoctorId === user?.id;
  const finalResponse = r.responses.find((x) => x.isFinal) ?? r.responses[0];

  const stageIndex =
    r.completedAt ? 3 : r.respondedAt ? 2 : r.acceptedAt ? 1 : 0;
  const closed = ['DECLINED', 'CANCELLED'].includes(r.status);

  return (
    <div className="space-y-space-6">
      <Link href="/referrals" className="inline-flex items-center gap-1.5 text-label-md text-outline hover:text-on-surface font-medium">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to referrals
      </Link>

      {/* Header */}
      <Card className="p-space-6 space-y-space-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-space-5">
          <div className="flex items-start gap-space-4 min-w-0">
            <Avatar
              name={`${r.patientFirstName} ${r.patientLastName}`}
              size="lg"
              tone={r.priority === 'EMERGENCY' || r.patientStatus === 'CRITICAL' ? 'critical' : 'info'}
            />
            <div className="min-w-0 space-y-space-2">
              <div className="flex items-center gap-space-2 flex-wrap">
                <h1 className="text-headline-lg text-on-surface font-bold tracking-tight">
                  {r.patientFirstName} {r.patientLastName}
                </h1>
                <Badge tone={priorityTone(r.priority)}>{titleCase(r.priority)}</Badge>
                <Badge tone={referralStatusTone(r.status)} dot>{titleCase(r.status)}</Badge>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                <span className="font-mono">{r.patientNumber}</span> · {calculateAge(r.patientDob)} years ·{' '}
                {genderLabel(r.patientGender) === 'M' ? 'Male' : genderLabel(r.patientGender) === 'F' ? 'Female' : titleCase(r.patientGender)}
                {' · referral '}<span className="font-mono">{r.referralNumber}</span>
              </p>
              {r.patientAllergies.length ? (
                <div className="flex items-center gap-space-2 px-space-3 py-1.5 rounded-lg bg-error-container text-on-error-container w-fit">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="text-body-sm font-semibold">Allergies: {r.patientAllergies.join(', ')}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-stretch sm:items-end gap-space-2 shrink-0">
            <Link href={`/patients/${r.patientId}`}>
              <Button variant="secondary" size="sm" icon={<ExternalLink className="h-4 w-4" />} className="w-full sm:w-auto">
                Open patient record
              </Button>
            </Link>
            {r.acceptedAt ? (
              <p className="text-label-md text-outline text-right">Access granted {timeAgo(r.acceptedAt)}</p>
            ) : isSpecialist ? (
              <p className="text-label-md text-outline text-right max-w-[220px]">
                Accepting grants you access to the full record.
              </p>
            ) : null}
          </div>
        </div>

        {/* Workflow progress */}
        {!closed ? (
          <ol className="flex items-center gap-space-2 overflow-x-auto cs-scroll pt-space-2">
            {STAGES.map((stage, i) => {
              const done = i <= stageIndex;
              const current = i === stageIndex;
              const Icon = stage.icon;
              return (
                <li key={stage.key} className="flex items-center gap-space-2 shrink-0">
                  <div className={cn('flex items-center gap-space-2 px-space-3 py-1.5 rounded-full text-label-md font-semibold',
                    done ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-outline',
                    current && !done ? 'ring-1 ring-secondary' : '')}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {stage.label}
                  </div>
                  {i < STAGES.length - 1 ? (
                    <span className={cn('w-6 h-0.5 rounded', i < stageIndex ? 'bg-primary' : 'bg-surface-container-high')} aria-hidden />
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="px-space-4 py-space-3 rounded-lg bg-surface-container-low">
            <p className="text-body-sm text-on-surface font-medium">
              This referral was {r.status.toLowerCase()}.
              {r.declineReason ? ` Reason: ${r.declineReason}` : ''}
            </p>
          </div>
        )}

        {/* Specialist / referrer actions */}
        {isSpecialist && !closed && r.status !== 'COMPLETED' ? (
          <div className="flex items-center gap-space-2 flex-wrap pt-space-2 border-t border-outline-variant/40">
            {r.status === 'PENDING' || r.status === 'REQUESTED_INFORMATION' ? (
              <>
                <Button icon={<Check className="h-4 w-4" />} onClick={() => accept.mutate()} loading={accept.isPending}>
                  Accept referral
                </Button>
                <Button variant="secondary" icon={<HelpCircle className="h-4 w-4" />} onClick={() => setInfoOpen(true)}>
                  Request more information
                </Button>
                <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setDeclineOpen(true)}>
                  Decline
                </Button>
              </>
            ) : null}

            {r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS' ? (
              <>
                <Button icon={<Stethoscope className="h-4 w-4" />} onClick={() => setRespondOpen(true)}>
                  {r.responses.length ? 'Add another response' : 'Record specialist response'}
                </Button>
                {r.responses.length ? (
                  <Button variant="accent" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => complete.mutate()} loading={complete.isPending}>
                    Complete referral
                  </Button>
                ) : null}
                <Button variant="secondary" icon={<HelpCircle className="h-4 w-4" />} onClick={() => setInfoOpen(true)}>
                  Request more information
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {isReferrer && r.status === 'REQUESTED_INFORMATION' ? (
          <div className="pt-space-2 border-t border-outline-variant/40">
            <div className="px-space-4 py-space-3 rounded-lg bg-warning-container/60 text-on-warning-container mb-space-3">
              <p className="text-body-sm font-semibold">{r.specialistDoctorName} has asked for more information</p>
              <p className="text-body-sm mt-1">{r.informationRequest}</p>
            </div>
            <Button icon={<MessageSquareReply className="h-4 w-4" />} onClick={() => setAnswerOpen(true)}>
              Supply the information
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-6">
        <div className="xl:col-span-8 space-y-space-6 min-w-0">
          <Card>
            <div className="px-space-6 py-space-4 border-b border-outline-variant/40">
              <h2 className="text-headline-sm text-on-surface font-semibold">Referral from {r.referringDoctorName}</h2>
              <p className="text-label-md text-outline mt-0.5">
                {r.fromDepartmentName} → {r.toDepartmentName} · {formatDateTime(r.createdAt)}
              </p>
            </div>
            <div className="p-space-6 space-y-space-5">
              <Detail label="Reason for referral" value={r.reason} emphasis />
              <Detail label="Clinical summary" value={r.clinicalSummary} />
              {r.symptoms ? <Detail label="Presenting symptoms" value={r.symptoms} /> : null}
              {r.relevantHistory ? <Detail label="Relevant history" value={r.relevantHistory} /> : null}
              {r.relevantInvestigations ? <Detail label="Relevant investigations" value={r.relevantInvestigations} /> : null}
              {r.currentMedications ? <Detail label="Current medications" value={r.currentMedications} /> : null}
              {r.informationRequest ? <Detail label="Information requested by specialist" value={r.informationRequest} /> : null}
              {r.informationResponse ? <Detail label="Information supplied by referrer" value={r.informationResponse} /> : null}
            </div>
          </Card>

          {r.responses.length > 0 ? (
            <Card>
              <div className="px-space-6 py-space-4 border-b border-outline-variant/40 flex items-center justify-between">
                <h2 className="text-headline-sm text-on-surface font-semibold">Specialist response</h2>
                {finalResponse?.isFinal ? <Badge tone="success">Final</Badge> : <Badge tone="attention">Draft</Badge>}
              </div>
              {r.responses.map((resp) => (
                <div key={resp.id} className="p-space-6 space-y-space-5 border-b border-outline-variant/30 last:border-b-0">
                  <p className="text-label-md text-outline">
                    {resp.authorName} · {formatDateTime(resp.createdAt)}
                  </p>
                  <Detail label="Assessment" value={resp.assessment} emphasis />
                  <Detail label="Findings" value={resp.findings} />
                  <Detail label="Recommendations" value={resp.recommendations} />
                  <Detail label="Treatment plan" value={resp.treatmentPlan} />
                  {resp.followUp ? <Detail label="Follow-up" value={resp.followUp} /> : null}
                </div>
              ))}
            </Card>
          ) : (
            <Card>
              <div className="px-space-6 py-space-8 text-center">
                <p className="text-body-md font-semibold text-on-surface">No specialist response yet</p>
                <p className="text-body-sm text-on-surface-variant mt-1">
                  {isSpecialist
                    ? 'Accept the referral, then record your assessment, findings, recommendations and plan.'
                    : `${r.specialistDoctorName} has not yet recorded a response. You will be notified when they do.`}
                </p>
              </div>
            </Card>
          )}
        </div>

        <aside className="xl:col-span-4 space-y-space-4 min-w-0">
          <Card>
            <div className="px-space-5 py-space-4 border-b border-outline-variant/40">
              <h2 className="text-headline-sm text-on-surface font-semibold">Referral details</h2>
            </div>
            <div className="p-space-5 space-y-space-1">
              <DataRow label="Referral number" value={<span className="font-mono">{r.referralNumber}</span>} />
              <DataRow label="Priority" value={<Badge tone={priorityTone(r.priority)}>{titleCase(r.priority)}</Badge>} />
              <DataRow label="Status" value={<Badge tone={referralStatusTone(r.status)}>{titleCase(r.status)}</Badge>} />
              <DataRow label="Referring doctor" value={r.referringDoctorName} />
              <DataRow label="From" value={r.fromDepartmentName} />
              <DataRow label="Specialist" value={r.specialistDoctorName} />
              <DataRow label="To" value={r.toDepartmentName} />
              {r.specialistSpecialization ? <DataRow label="Specialisation" value={r.specialistSpecialization} /> : null}
            </div>
          </Card>

          <Card>
            <div className="px-space-5 py-space-4 border-b border-outline-variant/40">
              <h2 className="text-headline-sm text-on-surface font-semibold">Audit trail</h2>
            </div>
            <div className="p-space-5 space-y-space-3">
              {[
                { label: 'Raised', at: r.createdAt, by: r.referringDoctorName },
                { label: 'Accepted', at: r.acceptedAt, by: r.specialistDoctorName },
                { label: 'Responded', at: r.respondedAt, by: r.specialistDoctorName },
                { label: 'Completed', at: r.completedAt, by: r.specialistDoctorName },
              ].filter((e) => e.at).map((e) => (
                <div key={e.label} className="flex items-start justify-between gap-space-3">
                  <div>
                    <p className="text-body-sm font-semibold text-on-surface">{e.label}</p>
                    <p className="text-label-md text-outline">{e.by}</p>
                  </div>
                  <span className="text-label-md text-outline text-right shrink-0">{formatDateTime(e.at!)}</span>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>

      {/* --- action modals --- */}

      <RespondModal
        open={respondOpen}
        onClose={() => setRespondOpen(false)}
        loading={respond.isPending}
        issues={issues}
        patientName={`${r.patientFirstName} ${r.patientLastName}`}
        onSubmit={(payload) => respond.mutate(payload)}
      />

      <ReasonModal
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title="Decline this referral"
        description="The referring doctor is notified with your reason, so they can plan an alternative."
        label="Reason for declining"
        placeholder="Troponin and ECG are reassuring; this does not require inpatient cardiology review. Please arrange outpatient follow-up if symptoms persist."
        submitLabel="Decline referral"
        loading={decline.isPending}
        error={issues.reason}
        onSubmit={(v) => decline.mutate(v)}
      />

      <ReasonModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="Request more information"
        description="The referral returns to the referring doctor until they answer, then comes back to you."
        label="What do you need to know?"
        placeholder="Could you confirm whether a 12-lead ECG and lying and standing blood pressures have been recorded?"
        submitLabel="Send request"
        loading={requestInfo.isPending}
        error={issues.question}
        onSubmit={(v) => requestInfo.mutate(v)}
      />

      <ReasonModal
        open={answerOpen}
        onClose={() => setAnswerOpen(false)}
        title="Supply the requested information"
        description="Your answer is added to the referral and the specialist is notified."
        label="Your response"
        placeholder="12-lead ECG performed on admission and reported as normal. No family history of sudden cardiac death."
        submitLabel="Send response"
        loading={provideInfo.isPending}
        error={issues.answer}
        onSubmit={(v) => provideInfo.mutate(v)}
      />
    </div>
  );
}

function Detail({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-label-md uppercase tracking-wider text-outline font-semibold mb-1">{label}</p>
      <p className={cn('whitespace-pre-wrap leading-relaxed',
        emphasis ? 'text-body-lg text-on-surface font-medium' : 'text-body-md text-on-surface')}>
        {value}
      </p>
    </div>
  );
}

function RespondModal({ open, onClose, onSubmit, loading, issues, patientName }: {
  open: boolean; onClose: () => void; loading: boolean; issues: Record<string, string>; patientName: string;
  onSubmit: (v: { assessment: string; findings: string; recommendations: string; treatmentPlan: string; followUp?: string }) => void;
}) {
  const formRef = React.useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? '').trim();
    onSubmit({
      assessment: text('assessment'),
      findings: text('findings'),
      recommendations: text('recommendations'),
      treatmentPlan: text('treatmentPlan'),
      followUp: text('followUp') || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record your specialist response"
      description={`For ${patientName}. This is written to the patient chart as a specialist note as well as to the referral.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="respond-form" loading={loading}>Save response</Button>
        </>
      }
    >
      <form id="respond-form" ref={formRef} onSubmit={submit} className="space-y-space-4" noValidate>
        <Field label="Assessment" htmlFor="assessment" required error={issues.assessment}
          hint="Your clinical impression, in one or two sentences.">
          <Textarea id="assessment" name="assessment" required rows={3} invalid={!!issues.assessment} autoFocus
            placeholder="Decompensated heart failure with cardiorenal syndrome type 1." />
        </Field>

        <Field label="Findings" htmlFor="findings" required error={issues.findings}>
          <Textarea id="findings" name="findings" required rows={4} invalid={!!issues.findings}
            placeholder="Elevated jugular venous pressure at 6 cm, bibasal crepitations, pitting oedema to mid-calf. Echocardiogram shows an ejection fraction of 32 per cent." />
        </Field>

        <Field label="Recommendations" htmlFor="recommendations" required error={issues.recommendations}>
          <Textarea id="recommendations" name="recommendations" required rows={4} invalid={!!issues.recommendations}
            placeholder="Reduce to furosemide 40 mg once daily and monitor daily weights. Replace potassium to keep above 4.0 mmol/L." />
        </Field>

        <Field label="Treatment plan" htmlFor="treatmentPlan" required error={issues.treatmentPlan}>
          <Textarea id="treatmentPlan" name="treatmentPlan" required rows={4} invalid={!!issues.treatmentPlan}
            placeholder="Furosemide 40 mg IV once daily. Potassium replacement 40 mmol daily. Fluid restriction 1.5 litres." />
        </Field>

        <Field label="Follow-up" htmlFor="followUp" hint="Optional, but it is what the referring team acts on next.">
          <Textarea id="followUp" name="followUp" rows={2}
            placeholder="Cardiology clinic in two weeks with repeat urea and electrolytes at 72 hours." />
        </Field>
      </form>
    </Modal>
  );
}

function ReasonModal({ open, onClose, onSubmit, title, description, label, placeholder, submitLabel, loading, error }: {
  open: boolean; onClose: () => void; onSubmit: (value: string) => void;
  title: string; description: string; label: string; placeholder: string;
  submitLabel: string; loading: boolean; error?: string;
}) {
  const [value, setValue] = React.useState('');

  React.useEffect(() => { if (!open) setValue(''); }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(value.trim())} loading={loading} disabled={value.trim().length === 0}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <Field label={label} htmlFor="reason-value" required error={error}>
        <Textarea
          id="reason-value"
          rows={5}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          invalid={!!error}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
