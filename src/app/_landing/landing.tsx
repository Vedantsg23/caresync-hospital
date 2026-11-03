import Link from 'next/link';
import { ArrowUpRight, Plus, Radio, ScrollText, ShieldCheck } from 'lucide-react';
import { DepartmentTour } from './department-tour';
import styles from './landing.module.css';

/**
 * The public front door, shown at "/" to anyone who is not signed in.
 *
 * Everything on it describes what the application actually does — the roles
 * mirror ROLE_PERMISSIONS in src/types/rbac.ts and the safeguards are the ones
 * listed under "Security model" in the README. The patient and the clinicians
 * in the illustrations are invented, like every record in the seed.
 */

const WHY = [
  {
    icon: ShieldCheck,
    title: 'Access follows care',
    body: 'A clinician opens a record because of a real relationship to the patient, checked in the service and again in the database. Knowing a patient number is never enough.',
  },
  {
    icon: ScrollText,
    title: 'Every action leaves a trace',
    body: 'Notes are versioned instead of overwritten, and every clinical action is attributed, timestamped and written to an audit trail that cannot be edited.',
  },
  {
    icon: Radio,
    title: 'News travels by itself',
    body: 'Results, referrals and alerts reach the people who need them as they happen, so nobody has to phone another department to ask.',
  },
];

const ROLES: { name: string; points: string[] }[] = [
  { name: 'Senior Doctor', points: ['Own caseload, full chart', 'Prescribing and discharge', 'Referrals raised and received'] },
  { name: 'Junior Doctor', points: ['Patients under their team', 'Notes and observations', 'Orders tests, raises referrals'] },
  { name: 'Nurse', points: ['Patients on their ward', 'Observations and nursing notes', 'Records medicines given'] },
  { name: 'Pathology', points: ['Laboratory worklist', 'Enters results', 'Critical values flag themselves'] },
  { name: 'Radiology', points: ['Imaging worklist', 'Reports studies', 'Flags critical findings'] },
  { name: 'Pharmacy', points: ['Dispensing worklist', 'Dispenses medicines', 'Never prescribes'] },
  { name: 'Staff administration', points: ['Staff records', 'Account requests and invitations', 'No access to any patient'] },
  { name: 'Hospital administrator', points: ['Admissions, wards and beds', 'Approves new accounts', 'Reads the audit trail'] },
  { name: 'System administrator', points: ['Everything above', 'Granted only by another administrator', 'Never self-registered'] },
];

const SAFEGUARDS = [
  { title: 'Row-level security', note: 'Database policies mirror the service rules, clause for clause' },
  { title: 'Append-only audit trail', note: 'A database trigger rejects every edit and delete' },
  { title: 'Versioned clinical notes', note: 'Earlier text is kept, never overwritten' },
  { title: 'Allergy interlock', note: 'Prescribing stops at an allergy on the record' },
  { title: 'Revocable sessions', note: 'Signing out, a password change or a role change ends the session at once' },
  { title: 'Approved privilege', note: 'Anyone can register; only an administrator grants a role' },
];

const FAQ = [
  {
    q: 'Who can sign in?',
    a: 'Hospital staff with an approved account: doctors, nurses, pathology, radiology, pharmacy and staff administration. Administrator roles are granted by an existing administrator and can never be requested.',
  },
  {
    q: 'How do I get an account?',
    a: 'Register with your work email and the role you need. After you confirm your email, an administrator reviews the request and assigns the role. You can also be invited by a colleague who has permission to do so.',
  },
  {
    q: 'Is there demo data on this deployment?',
    a: 'No. A real deployment starts empty on purpose: the first administrator is created once by the operator, and everyone else is invited or approved by a person after that.',
  },
  {
    q: 'Does the AI write to the chart?',
    a: 'Never. AI summaries are built only from records you can already see, are labelled with their provider, and are advisory. They cannot diagnose, prescribe or change anything.',
  },
  {
    q: 'Is CareSync a certified medical device?',
    a: 'No. It is a working demonstration of a clinical coordination workflow and has not been through any regulatory assessment. It should not be used to make clinical decisions.',
  },
];

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.wordmark} ${className ?? ''}`}>
      <b>CARE</b>SYNC
    </span>
  );
}

/** The connected view in one picture: one patient, every department on one timeline. */
function RecordCard() {
  return (
    <div className={styles.record} aria-hidden>
      <div className={styles.recordTop}>
        <span className={styles.avatar}>AR</span>
        <div>
          <p className={styles.recordName}>Ananya Rao</p>
          <p className={styles.recordMeta}>54, female · Bed 12, Ward 4B</p>
        </div>
        <span className={styles.recordStatus}>Admitted</span>
      </div>
      <div className={styles.vitals}>
        <div><span>Heart rate</span><b>96</b></div>
        <div><span>Blood pressure</span><b>128/82</b></div>
        <div><span>SpO₂</span><b>95%</b></div>
        <div className={styles.ews}><span>Early warning</span><b>3</b></div>
      </div>
      <ol className={styles.timeline}>
        <li><time>10:42</time><span className={styles.dept}>Nursing</span><p>Observations recorded</p></li>
        <li><time>10:15</time><span className={styles.dept}>Pathology</span><p>CRP 48 mg/L, flagged high</p></li>
        <li><time>09:30</time><span className={styles.dept}>Radiology</span><p>Chest X-ray reported</p></li>
        <li><time>08:55</time><span className={styles.dept}>Cardiology</span><p>Referral accepted by Dr. Priya Mehta</p></li>
        <li><time>08:30</time><span className={styles.dept}>Pharmacy</span><p>Ceftriaxone 1 g IV given</p></li>
      </ol>
      <p className={`${styles.float} ${styles.floatA}`}><span className={styles.floatDot} />Referral accepted</p>
      <p className={`${styles.float} ${styles.floatB}`}>Pathology result ready</p>
    </div>
  );
}

export function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="CareSync Hospital home"><Wordmark /></Link>
        <nav className={styles.headerNav} aria-label="Account">
          <Link href="/register" className={styles.headerLink}>Request access</Link>
          <Link href="/login" className={styles.pill}><span className={styles.pillDot} aria-hidden />Sign in</Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroBg} aria-hidden />
          <h1 id="hero-title" className={styles.heroTitle}>
            <span>One hospital.</span>
            <span>One view of</span>
            <span>the patient.</span>
          </h1>
          <p className={`${styles.heroLabel} ${styles.heroLabelA}`}>Every department<br />on one record</p>
          <p className={`${styles.heroLabel} ${styles.heroLabelB}`}>Built for<br />hospital staff</p>
          <RecordCard />
          <div className={styles.heroFoot}>
            <p>
              Nursing observations, notes, results, imaging, medicines and specialist referrals,
              brought together on one record, so no one has to ask where the information is.
            </p>
            <div className={styles.heroActions}>
              <Link href="/login" className={styles.pill}><span className={styles.pillDot} aria-hidden />Sign in</Link>
              <Link href="/register" className={styles.ghostPill}>Request access</Link>
            </div>
          </div>
        </section>

        <section className={styles.tour} aria-labelledby="tour-title">
          <h2 id="tour-title" className={styles.tourTitle}>Every department, one record</h2>
          <DepartmentTour />
        </section>

        <section className={styles.why} aria-labelledby="why-title">
          <div className={styles.sectionHead}>
            <h2 id="why-title" className={styles.h2}>Why one record?</h2>
            <p className={styles.lead}>Fewer phone calls between departments, and nothing lost on the way.</p>
          </div>
          <ul className={styles.whyGrid}>
            {WHY.map(({ icon: Icon, title, body }) => (
              <li key={title} className={styles.whyItem}>
                <Icon className={styles.whyIcon} strokeWidth={1.5} aria-hidden />
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.roles} aria-labelledby="roles-title">
          <div className={styles.sectionHead}>
            <h2 id="roles-title" className={styles.h2}>Nine roles, each with<br />its own view</h2>
            <p className={styles.lead}>
              What a person can reach depends on their role and on their relationship to each
              patient. Being a clinician is not by itself access to a record.
            </p>
          </div>
          <ul className={styles.roleRow}>
            {ROLES.map((r) => (
              <li key={r.name} className={styles.roleCard}>
                <h3>{r.name}</h3>
                <ul>
                  {r.points.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.safe} aria-labelledby="safe-title">
          <h2 id="safe-title" className={styles.h2}>Safeguards,<br />built in</h2>
          <ul className={styles.safeList}>
            {SAFEGUARDS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.note}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.faq} aria-labelledby="faq-title">
          <h2 id="faq-title" className={styles.h2}>Questions</h2>
          <div className={styles.faqList}>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}<Plus className={styles.faqIcon} strokeWidth={1.5} aria-hidden /></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footCard}>
          <div className={styles.footGlow} aria-hidden />
          <div className={styles.footTop}>
            <Wordmark className={styles.footMark} />
            <div className={styles.footCta}>
              <p>Ready to bring every ward onto one record?</p>
              <Link href="/register" className={styles.pill}><span className={styles.pillDot} aria-hidden />Request access</Link>
            </div>
          </div>
          <div className={styles.footBottom}>
            <p>Already have an account? <Link href="/login">Sign in</Link></p>
            <a href="https://github.com/Vedantsg23/caresync-hospital" target="_blank" rel="noopener noreferrer" className={styles.footLink}>
              Source on GitHub <ArrowUpRight className={styles.footArrow} aria-hidden />
            </a>
          </div>
        </div>
        <div className={styles.legal}>
          <p>© 2026 CareSync Hospital</p>
          <p>Handles sensitive clinical information. Every access is recorded.</p>
        </div>
      </footer>
    </div>
  );
}
