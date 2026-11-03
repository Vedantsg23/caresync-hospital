'use client';

import * as React from 'react';
import styles from './landing.module.css';

/**
 * Six departments, one record. Choosing a department on the left shows what
 * that department works in on the right — drawn as simplified screens of the
 * real application, with invented patients and staff.
 */

type Tone = 'ok' | 'warn' | 'risk' | 'info';

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`${styles.chip} ${styles[`chip_${tone}`]}`}>{children}</span>;
}

function Screen({ crumb, user, children }: { crumb: string; user: string; children: React.ReactNode }) {
  return (
    <div className={styles.screen}>
      <div className={styles.screenBar}>
        <span className={styles.screenLogo} aria-hidden>+</span>
        <span className={styles.screenApp}>CareSync</span>
        <span className={styles.screenCrumb}>/ {crumb}</span>
        <span className={styles.screenUser}>{user}</span>
      </div>
      <div className={styles.screenBody}>{children}</div>
    </div>
  );
}

function Nursing() {
  const rows: [string, string, string, Tone, string, string][] = [
    ['07', 'Imran Shaikh', '09:58', 'risk', '5', 'Now'],
    ['12', 'Ananya Rao', '10:42', 'warn', '3', '11:42'],
    ['03', 'Lata Joshi', '10:20', 'ok', '1', '14:20'],
    ['15', 'Arjun Menon', '08:40', 'ok', '0', '12:40'],
  ];
  return (
    <Screen crumb="Ward 4B" user="Sister Meera Nair, Nurse">
      <div className={styles.sHead}><h4>Observations due</h4><p>Ordered by acuity</p></div>
      <table className={styles.sTable}>
        <thead><tr><th>Bed</th><th>Patient</th><th>Last set</th><th>Early warning</th><th>Next due</th></tr></thead>
        <tbody>
          {rows.map(([bed, name, last, tone, score, due]) => (
            <tr key={bed}>
              <td>{bed}</td><td><b>{name}</b></td><td>{last}</td>
              <td><Chip tone={tone}>{score}{tone === 'risk' ? ', escalated' : ''}</Chip></td>
              <td>{due}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.sNote}>An abnormal set raises the patient’s status and alerts the attending clinician.</p>
    </Screen>
  );
}

function Doctors() {
  return (
    <Screen crumb="Patients / Ananya Rao" user="Dr. Aarav Sharma, Senior Doctor">
      <div className={styles.sPatient}>
        <span className={styles.sAvatar}>AR</span>
        <div><h4>Ananya Rao</h4><p>54, female. Bed 12, Ward 4B. Allergy: penicillin</p></div>
      </div>
      <div className={styles.sTabs}>
        {['Overview', 'Notes', 'Results', 'Imaging', 'Medicines', 'Referrals', 'Timeline'].map((t) => (
          <span key={t} className={t === 'Notes' ? styles.sTabOn : undefined}>{t}</span>
        ))}
      </div>
      <div className={styles.sNoteCard}>
        <p className={styles.sKicker}>Progress note, version 2</p>
        <p>Fever settling. CRP 48, down from 71 yesterday. Continue IV antibiotics; chest X-ray to be reviewed with cardiology.</p>
        <p className={styles.sMuted}>Edited 10:50 by Dr. Aarav Sharma. The earlier version is kept.</p>
      </div>
    </Screen>
  );
}

function Pathology() {
  const rows: [string, string, string, Tone, string][] = [
    ['Potassium', '6.1 mmol/L', '3.5 to 5.1', 'risk', 'Critical'],
    ['C-reactive protein', '48 mg/L', 'Below 5', 'warn', 'High'],
    ['Haemoglobin', '12.8 g/dL', '12.0 to 15.5', 'ok', 'Normal'],
    ['Creatinine', '1.0 mg/dL', '0.6 to 1.1', 'ok', 'Normal'],
  ];
  return (
    <Screen crumb="Laboratory worklist" user="Dr. Ananya Bose, Pathology">
      <div className={styles.sHead}><h4>Results for Ananya Rao</h4><p>Order LAB-2041</p></div>
      <table className={styles.sTable}>
        <thead><tr><th>Test</th><th>Result</th><th>Reference range</th><th>Flag</th></tr></thead>
        <tbody>
          {rows.map(([test, result, range, tone, flag]) => (
            <tr key={test}><td><b>{test}</b></td><td>{result}</td><td>{range}</td><td><Chip tone={tone}>{flag}</Chip></td></tr>
          ))}
        </tbody>
      </table>
      <p className={styles.sNote}>A critical value goes straight to the requesting doctor.</p>
    </Screen>
  );
}

function Radiology() {
  const rows: [string, string, Tone, string][] = [
    ['Chest X-ray', 'Ananya Rao', 'ok', 'Reported'],
    ['MRI brain', 'Imran Shaikh', 'risk', 'Critical finding'],
    ['CT abdomen', 'Lata Joshi', 'info', 'Scheduled 14:00'],
    ['Ultrasound', 'Arjun Menon', 'warn', 'Requested'],
  ];
  return (
    <Screen crumb="Imaging worklist" user="Dr. Rohan Desai, Radiology">
      <div className={styles.sHead}><h4>Today</h4><p>4 studies</p></div>
      <ul className={styles.sList}>
        {rows.map(([study, name, tone, status]) => (
          <li key={study}><div><b>{study}</b><span>{name}</span></div><Chip tone={tone}>{status}</Chip></li>
        ))}
      </ul>
      <p className={styles.sNote}>Reports are written once and land on the patient’s record for everyone in their care.</p>
    </Screen>
  );
}

function Pharmacy() {
  return (
    <Screen crumb="Prescribe" user="Dr. Aarav Sharma, Senior Doctor">
      <div className={styles.sHead}><h4>New prescription</h4><p>Ananya Rao</p></div>
      <div className={styles.sField}><span>Medicine</span><b>Amoxicillin 500 mg, three times a day</b></div>
      <div className={styles.sAlert}>
        <b>Blocked: penicillin allergy recorded</b>
        <p>Recorded on admission by Sister Meera Nair. Choose another medicine.</p>
      </div>
      <ul className={styles.sList}>
        <li><div><b>Ceftriaxone 1 g IV</b><span>Dispensed 08:10</span></div><Chip tone="ok">Given 08:30</Chip></li>
        <li><div><b>Paracetamol 1 g</b><span>Every 6 hours</span></div><Chip tone="info">Due 12:00</Chip></li>
      </ul>
    </Screen>
  );
}

function Referrals() {
  const steps = ['Created', 'Accepted', 'Response', 'Completed'];
  return (
    <Screen crumb="Referrals / Cardiology" user="Dr. Priya Mehta, Cardiology">
      <div className={styles.sHead}><h4>Referral for Ananya Rao</h4><p>Urgent</p></div>
      <ol className={styles.sSteps}>
        {steps.map((s, i) => (
          <li key={s} className={i < 3 ? styles.sStepDone : styles.sStepNow}><span>{i + 1}</span>{s}</li>
        ))}
      </ol>
      <div className={styles.sNoteCard}>
        <p className={styles.sKicker}>Specialist response</p>
        <p>Echo shows preserved function. Start a beta blocker and review in cardiology clinic in six weeks.</p>
        <p className={styles.sMuted}>Written to the chart as a specialist note. Accepting gave scoped access to this record only.</p>
      </div>
    </Screen>
  );
}

const DEPARTMENTS = [
  { key: 'nursing', name: 'Nursing', sub: 'Observations and early-warning scores', View: Nursing },
  { key: 'doctors', name: 'Doctors', sub: 'Notes, orders and prescribing', View: Doctors },
  { key: 'pathology', name: 'Pathology', sub: 'Results flagged against ranges', View: Pathology },
  { key: 'radiology', name: 'Radiology', sub: 'Requests, reports and critical findings', View: Radiology },
  { key: 'pharmacy', name: 'Pharmacy', sub: 'Allergy interlock and dispensing', View: Pharmacy },
  { key: 'referrals', name: 'Specialists', sub: 'Referrals from request to reply', View: Referrals },
] as const;

export function DepartmentTour() {
  const [active, setActive] = React.useState(0);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const Current = DEPARTMENTS[active].View;

  function onKey(e: React.KeyboardEvent, i: number) {
    const last = DEPARTMENTS.length - 1;
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className={styles.tourGrid}>
      <div className={styles.tourList} role="tablist" aria-label="Departments" aria-orientation="vertical">
        {DEPARTMENTS.map((d, i) => (
          <button
            key={d.key}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`tour-tab-${d.key}`}
            aria-selected={i === active}
            aria-controls="tour-panel"
            tabIndex={i === active ? 0 : -1}
            className={`${styles.tourTab} ${i === active ? styles.tourTabOn : ''}`}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className={styles.tourName}>{d.name}</span>
            <span className={styles.tourSub}>{d.sub}</span>
          </button>
        ))}
      </div>
      <div className={styles.tourPanel} role="tabpanel" id="tour-panel" aria-labelledby={`tour-tab-${DEPARTMENTS[active].key}`}>
        <Current key={DEPARTMENTS[active].key} />
      </div>
    </div>
  );
}
