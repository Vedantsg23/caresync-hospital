/**
 * Who this system is for.
 *
 * A new arrival lands on a sign-in page for a hospital they may or may not work
 * in, and the honest questions are "is this for me?" and "what will I be able to
 * see?". Answering them here is worth more than answering them in a support
 * email later, and it makes the boundary explicit: seven roles can be applied
 * for, administrator roles cannot.
 *
 * The descriptions are what each role can actually reach — they mirror
 * ROLE_PERMISSIONS in src/types/rbac.ts, which is what the server enforces.
 */

const ROLES: { label: string; sees: string }[] = [
  {
    label: 'Senior Doctor / Consultant',
    sees: 'Own caseload, full chart access, prescribing, and referrals raised and received. A specialist is a consultant with a declared specialty — referrals are addressed to them by name.',
  },
  {
    label: 'Junior Doctor',
    sees: 'Patients under their team: notes, observations, investigations, and referrals they raise.',
  },
  {
    label: 'Nurse',
    sees: 'Patients admitted to their ward. Records observations and nursing notes; no prescribing.',
  },
  {
    label: 'Radiology',
    sees: 'The imaging worklist and patients with an imaging request. Reports studies; no prescribing or pathology.',
  },
  {
    label: 'Pathology / Laboratory',
    sees: 'The laboratory worklist and patients with a laboratory order. Enters results, which flag automatically when critical.',
  },
  {
    label: 'Pharmacy',
    sees: 'The dispensing worklist and patients with a medication order. Dispenses and records administration; does not prescribe.',
  },
  {
    label: 'HR / Staff Administration',
    sees: 'Staff records, account requests and invitations. No clinical access to any patient, at all.',
  },
];

export function WhoCanSignIn() {
  return (
    <section aria-labelledby="who-can-sign-in" className="space-y-space-4">
      <div className="space-y-1">
        <h3 id="who-can-sign-in" className="text-body-md font-semibold text-on-surface">
          Who can use CareSync
        </h3>
        <p className="text-body-sm text-on-surface-variant">
          Seven roles can apply for an account. What you can reach depends on your role and on
          your relationship to each patient — being a clinician is not by itself access to a
          record.
        </p>
      </div>

      <ul className="divide-y divide-outline-variant/40 rounded-xl border border-outline-variant/60 overflow-hidden">
        {ROLES.map((r) => (
          <li key={r.label} className="px-space-4 py-space-3 bg-surface-container-lowest">
            <p className="text-body-sm font-semibold text-on-surface">{r.label}</p>
            <p className="text-body-sm text-on-surface-variant mt-0.5">{r.sees}</p>
          </li>
        ))}
      </ul>

      <p className="text-body-sm text-on-surface-variant">
        <span className="font-medium text-on-surface">Hospital Administrator</span> and{' '}
        <span className="font-medium text-on-surface">System Administrator</span> are not on that
        list on purpose. They cannot be self-registered under any circumstances — an existing
        administrator grants them, and the server refuses the role however the request is
        constructed.
      </p>
    </section>
  );
}
