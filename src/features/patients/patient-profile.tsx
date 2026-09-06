'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Send, Activity, FileText, Sparkles, ShieldAlert, Phone, MapPin,
  Stethoscope, Pill, FlaskConical,
} from 'lucide-react';
import { patientsApi } from '@/lib/api/endpoints';
import { useAuth } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Avatar, Badge, Button, Card, DataRow, ErrorState, LoadingBlock, Tabs,
  patientStatusTone,
} from '@/components/ui';
import { bloodGroupLabel, cn, formatDate, genderLabel, timeAgo, titleCase, vitalsSummary } from '@/lib/utils';
import { PERMISSIONS } from '@/types/rbac';
import { CreateReferralModal } from '@/features/referrals/create-referral-modal';
import { RecordVitalsModal } from './modals/record-vitals-modal';
import { AddNoteModal } from './modals/add-note-modal';
import { OrderInvestigationModal } from './modals/order-investigation-modal';
import { PrescribeModal } from './modals/prescribe-modal';
import {
  OverviewTab, TimelineTab, VitalsTab, NotesTab, InvestigationsTab,
  PathologyTab, RadiologyTab, MedicationsTab, ReferralsTab, DocumentsTab,
} from './patient-tabs';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'notes', label: 'Clinical Notes' },
  { id: 'investigations', label: 'Investigations' },
  { id: 'pathology', label: 'Pathology' },
  { id: 'radiology', label: 'Radiology' },
  { id: 'medications', label: 'Medications' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'documents', label: 'Documents' },
];

export function PatientProfile({ patientId }: { patientId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();

  const tab = params.get('tab') ?? 'overview';
  const [referOpen, setReferOpen] = React.useState(false);
  const [vitalsOpen, setVitalsOpen] = React.useState(false);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [orderOpen, setOrderOpen] = React.useState(false);
  const [prescribeOpen, setPrescribeOpen] = React.useState(false);

  // Live updates for this specific patient.
  useRealtime({ patientId });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient', patientId, 'header'],
    queryFn: () => patientsApi.getPatient(patientId),
  });

  function setTab(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === 'overview') next.delete('tab'); else next.set('tab', id);
    router.replace(`/patients/${patientId}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  }

  if (isLoading) {
    return (
      <div className="space-y-space-6">
        <div className="cs-skeleton h-48 rounded-xl" />
        <Card><LoadingBlock rows={5} /></Card>
      </div>
    );
  }

  if (isError) {
    const message = (error as { message?: string })?.message ?? '';
    const denied = message.toLowerCase().includes('access');
    return (
      <ErrorState
        title={denied ? 'You do not have access to this patient' : 'Unable to load the patient record'}
        message={
          denied
            ? 'Access follows a clinical relationship: being the attending clinician, a member of the care team, or a party to a referral. This attempt has been recorded in the audit trail.'
            : message
        }
        onRetry={denied ? undefined : () => refetch()}
      />
    );
  }

  const p = data!.data;
  const admission = p.admission;

  return (
    <div className="space-y-space-6">
      <Link href="/patients" className="inline-flex items-center gap-1.5 text-label-md text-outline hover:text-on-surface font-medium">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to patient registry
      </Link>

      {/* Patient header - identity, location, care team, allergies at a glance */}
      <Card className="overflow-hidden">
        <div className="p-space-6 flex flex-col xl:flex-row xl:items-start justify-between gap-space-6">
          <div className="flex items-start gap-space-4 min-w-0">
            <Avatar
              name={p.fullName}
              size="lg"
              tone={p.status === 'CRITICAL' ? 'critical' : p.status === 'NEEDS_ATTENTION' ? 'attention' : 'info'}
            />
            <div className="min-w-0 space-y-space-2">
              <div className="flex items-center gap-space-3 flex-wrap">
                <h1 className="text-headline-lg text-on-surface font-bold tracking-tight">{p.fullName}</h1>
                <Badge tone={patientStatusTone(p.status)} dot>
                  {p.status === 'CRITICAL' ? 'Critical' : p.status === 'NEEDS_ATTENTION' ? 'Needs attention' : 'Stable'}
                </Badge>
              </div>

              <div className="flex items-center gap-space-3 text-body-sm text-on-surface-variant flex-wrap">
                <span className="font-mono text-on-surface font-medium">{p.patientNumber}</span>
                <span aria-hidden>·</span>
                <span>{p.age} years · {genderLabel(p.gender) === 'M' ? 'Male' : genderLabel(p.gender) === 'F' ? 'Female' : titleCase(p.gender)}</span>
                <span aria-hidden>·</span>
                <span>Blood group {bloodGroupLabel(p.bloodGroup)}</span>
                <span aria-hidden>·</span>
                <span>DOB {formatDate(p.dateOfBirth)}</span>
              </div>

              {p.allergies.length > 0 ? (
                <div className="flex items-center gap-space-2 px-space-3 py-1.5 rounded-lg bg-error-container text-on-error-container w-fit">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="text-body-sm font-semibold">Allergies: {p.allergies.join(', ')}</span>
                </div>
              ) : (
                <p className="text-label-md text-outline">No known drug allergies recorded.</p>
              )}

              {p.chronicConditions.length > 0 ? (
                <div className="flex items-center gap-space-2 flex-wrap">
                  {p.chronicConditions.map((c) => <Badge key={c} tone="muted">{c}</Badge>)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-space-2 flex-wrap shrink-0">
            {can(PERMISSIONS.VITALS_CREATE) ? (
              <Button variant="secondary" size="sm" icon={<Activity className="h-4 w-4" />} onClick={() => setVitalsOpen(true)}>
                Record vitals
              </Button>
            ) : null}
            {can(PERMISSIONS.NOTE_CREATE) ? (
              <Button variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => setNoteOpen(true)}>
                Add note
              </Button>
            ) : null}
            {can(PERMISSIONS.LAB_ORDER) ? (
              <Button variant="secondary" size="sm" icon={<FlaskConical className="h-4 w-4" />} onClick={() => setOrderOpen(true)}>
                Order investigation
              </Button>
            ) : null}
            {can(PERMISSIONS.MEDICATION_PRESCRIBE) ? (
              <Button variant="secondary" size="sm" icon={<Pill className="h-4 w-4" />} onClick={() => setPrescribeOpen(true)}>
                Prescribe
              </Button>
            ) : null}
            {can(PERMISSIONS.REFERRAL_CREATE) ? (
              <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setReferOpen(true)}>
                Refer to specialist
              </Button>
            ) : null}
          </div>
        </div>

        {/* Location / admission strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-outline-variant/40 border-t border-outline-variant/40">
          {[
            { label: 'Admission', value: admission?.admissionNumber ?? 'Not admitted', mono: true },
            { label: 'Ward', value: admission?.wardName ?? '—' },
            { label: 'Bed', value: admission?.bedCode ?? '—', mono: true },
            { label: 'Attending', value: admission?.attendingDoctorName ?? '—' },
            { label: 'Department', value: admission?.departmentName ?? '—' },
          ].map((cell) => (
            <div key={cell.label} className="bg-surface-container-lowest px-space-6 py-space-3">
              <p className="text-label-sm uppercase tracking-wider text-outline font-semibold">{cell.label}</p>
              <p className={cn('text-body-sm text-on-surface font-medium mt-0.5 truncate', cell.mono && 'font-mono')}>
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-6">
        <div className="xl:col-span-9 min-w-0 space-y-space-4">
          <Card className="overflow-hidden">
            <Tabs tabs={TABS} active={tab} onChange={setTab} className="px-space-3" />
            <div className="p-space-6">
              {tab === 'overview' && <OverviewTab patient={p} onTabChange={setTab} />}
              {tab === 'timeline' && <TimelineTab patientId={patientId} />}
              {tab === 'vitals' && <VitalsTab patientId={patientId} onRecord={() => setVitalsOpen(true)} />}
              {tab === 'notes' && <NotesTab patientId={patientId} onAdd={() => setNoteOpen(true)} />}
              {tab === 'investigations' && <InvestigationsTab patientId={patientId} onOrder={() => setOrderOpen(true)} />}
              {tab === 'pathology' && <PathologyTab patientId={patientId} />}
              {tab === 'radiology' && <RadiologyTab patientId={patientId} />}
              {tab === 'medications' && <MedicationsTab patientId={patientId} onPrescribe={() => setPrescribeOpen(true)} />}
              {tab === 'referrals' && <ReferralsTab patientId={patientId} onRefer={() => setReferOpen(true)} />}
              {tab === 'documents' && <DocumentsTab patientId={patientId} />}
            </div>
          </Card>
        </div>

        <aside className="xl:col-span-3 space-y-space-4 min-w-0">
          <Card>
            <div className="px-space-5 py-space-4 border-b border-outline-variant/40">
              <h2 className="text-headline-sm text-on-surface font-semibold flex items-center gap-space-2">
                <Stethoscope className="h-4 w-4 text-secondary" aria-hidden /> Care team
              </h2>
            </div>
            <div className="p-space-5 space-y-space-3">
              {p.careTeam.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">No care team members assigned yet.</p>
              ) : (
                p.careTeam.map((m) => (
                  <div key={m.id} className="flex items-center gap-space-3">
                    <Avatar name={m.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-body-sm font-semibold text-on-surface truncate">{m.name}</p>
                      <p className="text-label-md text-outline truncate">{titleCase(m.role)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <div className="px-space-5 py-space-4 border-b border-outline-variant/40">
              <h2 className="text-headline-sm text-on-surface font-semibold">Latest observations</h2>
            </div>
            <div className="p-space-5">
              {p.latestVitals ? (
                <div className="space-y-space-3">
                  <div className="grid grid-cols-2 gap-space-3">
                    {[
                      { k: 'BP', v: p.latestVitals.bloodPressureSystolic && p.latestVitals.bloodPressureDiastolic ? `${p.latestVitals.bloodPressureSystolic}/${p.latestVitals.bloodPressureDiastolic}` : '—', u: 'mmHg' },
                      { k: 'Heart rate', v: p.latestVitals.heartRate ?? '—', u: 'bpm' },
                      { k: 'SpO2', v: p.latestVitals.spo2 ?? '—', u: '%' },
                      { k: 'Temperature', v: p.latestVitals.temperatureC ?? '—', u: '°C' },
                    ].map((m) => (
                      <div key={m.k} className="bg-surface-container-low rounded-lg px-space-3 py-space-2">
                        <p className="text-label-sm text-outline uppercase tracking-wider">{m.k}</p>
                        <p className="text-body-md font-mono font-semibold text-on-surface">
                          {m.v}<span className="text-label-md text-outline ml-1 font-sans">{m.u}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                  {p.latestVitals.newsScore != null ? (
                    <div className={cn('px-space-3 py-1.5 rounded-lg text-label-md font-semibold',
                      p.latestVitals.newsScore >= 6 ? 'bg-error-container text-on-error-container'
                        : p.latestVitals.newsScore >= 3 ? 'bg-warning-container text-on-warning-container'
                        : 'bg-tertiary-fixed/40 text-on-tertiary-fixed-variant')}>
                      Aggregate early-warning score {p.latestVitals.newsScore}
                    </div>
                  ) : null}
                  <p className="text-label-md text-outline">
                    Recorded {timeAgo(p.latestVitals.recordedAt)}
                    {p.latestVitals.recordedByName ? ` by ${p.latestVitals.recordedByName}` : ''}
                  </p>
                </div>
              ) : (
                <p className="text-body-sm text-on-surface-variant">{vitalsSummary(null)}</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="px-space-5 py-space-4 border-b border-outline-variant/40">
              <h2 className="text-headline-sm text-on-surface font-semibold">Contact</h2>
            </div>
            <div className="p-space-5 space-y-space-1">
              <DataRow label="Phone" value={p.phone ? <span className="font-mono">{p.phone}</span> : '—'} />
              <DataRow label="Email" value={p.email ?? '—'} />
              <DataRow
                label="Address"
                value={[p.addressLine, p.city].filter(Boolean).join(', ') || '—'}
              />
              {p.contacts.map((c) => (
                <div key={c.id} className="pt-space-3 mt-space-2 border-t border-outline-variant/40">
                  <p className="text-label-sm uppercase tracking-wider text-outline font-semibold flex items-center gap-1.5">
                    <Phone className="h-3 w-3" aria-hidden /> Emergency contact
                  </p>
                  <p className="text-body-sm font-semibold text-on-surface mt-1">{c.name}</p>
                  <p className="text-label-md text-outline">{c.relationship} · <span className="font-mono">{c.phone}</span></p>
                </div>
              ))}
            </div>
          </Card>

          <Link
            href={`/patients/${patientId}?tab=timeline`}
            onClick={(e) => { e.preventDefault(); setTab('timeline'); }}
            className="flex items-center justify-between gap-space-2 px-space-5 py-space-4 rounded-xl
                       bg-primary-container text-on-primary-container hover:opacity-95 transition-opacity"
          >
            <span className="flex items-center gap-space-2 text-body-sm font-semibold text-on-primary">
              <Sparkles className="h-4 w-4 text-tertiary-fixed-dim" aria-hidden />
              View full patient timeline
            </span>
            <MapPin className="h-4 w-4 text-primary-fixed-dim" aria-hidden />
          </Link>
        </aside>
      </div>

      <CreateReferralModal open={referOpen} onClose={() => setReferOpen(false)} patient={p} />
      <RecordVitalsModal open={vitalsOpen} onClose={() => setVitalsOpen(false)} patientId={patientId} patientName={p.fullName} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} patientId={patientId} patientName={p.fullName} />
      <OrderInvestigationModal open={orderOpen} onClose={() => setOrderOpen(false)} patientId={patientId} patientName={p.fullName} />
      <PrescribeModal open={prescribeOpen} onClose={() => setPrescribeOpen(false)} patientId={patientId} patientName={p.fullName} allergies={p.allergies} />
    </div>
  );
}
