'use client';

import Link from 'next/link';
import { BookOpen, Send, Activity, Shield, Sparkles, LifeBuoy } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { Card, Badge } from '@/components/ui';
import { ROLE_LABELS } from '@/types/rbac';

const WORKFLOWS = [
  {
    icon: Send,
    title: 'Refer a patient to a specialist',
    steps: [
      'Open the patient record and choose "Refer to specialist".',
      'The clinical context is drafted from the live record. Review it, choose the specialist and set a priority.',
      'The specialist is notified immediately and the referral appears on their inbox.',
      'When they accept, they gain scoped access to the record and you are notified back.',
      'Their assessment arrives as a specialist response on the referral and as a note on the chart.',
    ],
  },
  {
    icon: Activity,
    title: 'Record observations',
    steps: [
      'From the nursing ward list or the patient record, choose "Record vitals".',
      'Enter whichever measurements were taken; leave the rest blank.',
      'An aggregate early-warning score is calculated and saved with the set.',
      'If the score is raised, the attending clinician is alerted and the patient status escalates.',
    ],
  },
  {
    icon: BookOpen,
    title: 'Find a patient',
    steps: [
      'Use the search box in the header, or open Patients for filters and pagination.',
      'Search by name, patient number or admission number.',
      'Only patients you are involved in caring for are returned, whatever you type.',
    ],
  },
];

export function HelpGuide() {
  const { user } = useAuth();

  return (
    <div className="space-y-space-8 max-w-4xl">
      <div>
        <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Help &amp; support</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          {user ? (
            <>You are signed in as <strong className="text-on-surface font-semibold">{user.fullName}</strong>, {ROLE_LABELS[user.role]}
            {user.departmentName ? ` in ${user.departmentName}` : ''}. What you can see and do follows that role.</>
          ) : 'Common workflows in CareSync.'}
        </p>
      </div>

      <div className="grid gap-space-4">
        {WORKFLOWS.map((w) => (
          <Card key={w.title} className="p-space-6">
            <div className="flex items-start gap-space-4">
              <span className="w-10 h-10 rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant flex items-center justify-center shrink-0">
                <w.icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-headline-sm text-on-surface font-semibold">{w.title}</h2>
                <ol className="mt-space-3 space-y-space-2">
                  {w.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-space-3 text-body-sm text-on-surface-variant">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-surface-container-high text-on-surface text-label-sm font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-space-6 space-y-space-4">
        <h2 className="text-headline-sm text-on-surface font-semibold flex items-center gap-space-2">
          <Shield className="h-4 w-4 text-secondary" aria-hidden /> Access and privacy
        </h2>
        <ul className="space-y-space-2 text-body-sm text-on-surface-variant">
          <li>Access follows a clinical relationship: attending clinician, care team member, encounter provider, referral party, or an explicit grant.</li>
          <li>Knowing a patient number is never enough. Unauthorised attempts are refused and recorded in the audit trail.</li>
          <li>Every clinical entry carries its author and timestamp. Notes are versioned rather than overwritten.</li>
          <li>Uploaded documents are served through an authenticated route, never a public link.</li>
        </ul>
      </Card>

      <Card className="p-space-6 space-y-space-3">
        <h2 className="text-headline-sm text-on-surface font-semibold flex items-center gap-space-2">
          <Sparkles className="h-4 w-4 text-secondary" aria-hidden /> About the AI assistance
        </h2>
        <Badge tone="attention">Advisory only — always review</Badge>
        <p className="text-body-sm text-on-surface-variant">
          Summaries are composed from information already on the record and are labelled for review.
          The AI layer never diagnoses, prescribes, changes a medication, alters an order or moves a referral forward.
          Every generated summary is stored with the clinician who requested it.
        </p>
      </Card>

      <Card className="p-space-6 flex items-start gap-space-4">
        <LifeBuoy className="h-5 w-5 text-secondary shrink-0 mt-0.5" aria-hidden />
        <div>
          <h2 className="text-headline-sm text-on-surface font-semibold">Something not working?</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">
            This is a demonstration environment containing invented patient data only.
            If a screen fails to load, the error page offers a retry, and no clinical data is changed by a failed request.
          </p>
          <Link href="/" className="inline-block mt-space-3 text-label-md text-secondary font-semibold hover:underline">
            Return to your dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}
