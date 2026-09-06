/**
 * CareSync Hospital - demo data seed.
 *
 * Produces a hospital that behaves like a real one on the first page load:
 * departments, wards and beds; staff across every role; patients with
 * admissions, care teams, observation series, laboratory and imaging results,
 * medication records, referrals in every state, notifications, a populated
 * patient timeline and an audit trail.
 *
 * All patient data is invented. Never load real patient information here.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db, pool } from '../src/server/db/client';
import * as s from '../src/server/db/schema';
import { ROLES, ROLE_PERMISSIONS, ROLE_LABELS, PERMISSIONS, type Role } from '../src/types/rbac';

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'CareSync#2026';
const FORCE = process.env.SEED_FORCE === 'true';

/**
 * `--if-empty` (or SEED_IF_EMPTY=true) makes an already-populated database a
 * no-op success instead of an error. Deployments run this on every build: the
 * first one seeds the demo hospital, every later one leaves the data alone
 * rather than failing the build or wiping what people have entered.
 */
const IF_EMPTY = process.argv.includes('--if-empty') || process.env.SEED_IF_EMPTY === 'true';

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const dob = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

let step = 0;
const log = (msg: string) => console.log(`  ${String(++step).padStart(2, '0')}. ${msg}`);

/* ------------------------------------------------------------- helpers --- */

type TimelineInput = {
  patientId: string;
  admissionId?: string | null;
  eventType: (typeof s.timelineEventTypeEnum.enumValues)[number];
  title: string;
  description?: string | null;
  actorId?: string | null;
  departmentId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  severity?: 'INFO' | 'ATTENTION' | 'CRITICAL';
  occurredAt: Date;
};

const timelineBuffer: TimelineInput[] = [];
const pushEvent = (e: TimelineInput) => timelineBuffer.push(e);

async function flushTimeline() {
  if (!timelineBuffer.length) return;
  for (let i = 0; i < timelineBuffer.length; i += 500) {
    await db.insert(s.timelineEvents).values(
      timelineBuffer.slice(i, i + 500).map((e) => ({
        patientId: e.patientId,
        admissionId: e.admissionId ?? null,
        eventType: e.eventType,
        title: e.title,
        description: e.description ?? null,
        actorId: e.actorId ?? null,
        departmentId: e.departmentId ?? null,
        referenceType: e.referenceType ?? null,
        referenceId: e.referenceId ?? null,
        severity: e.severity ?? 'INFO',
        occurredAt: e.occurredAt,
      })),
    );
  }
}

/* ---------------------------------------------------------------- main --- */

async function main() {
  console.log('\nCareSync Hospital - seeding demo data\n');

  const [{ count }] = (await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM users`,
  )).rows as unknown as { count: string }[];

  if (Number(count) > 0 && !FORCE) {
    if (IF_EMPTY) {
      console.log(`  Database already has ${count} users - leaving it untouched.\n`);
      await pool.end();
      process.exit(0);
    }
    console.error(
      '\n  Refusing to seed: the database already contains users.\n' +
      '  Set SEED_FORCE=true to wipe and reseed (destructive), or pass\n' +
      '  --if-empty to make an already-seeded database a no-op.\n',
    );
    process.exit(1);
  }

  log('clearing existing data');
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs, timeline_events, ai_summaries, file_blobs, attachments,
      messages, conversation_participants, conversations, notifications,
      referral_responses, referrals, medication_administrations, medication_orders,
      medications, radiology_reports, radiology_studies, investigation_results,
      investigation_orders, investigations, clinical_note_versions, clinical_notes,
      observations, vital_signs, care_team_members, encounters, admission_transfers,
      admissions, beds, wards, patient_access_grants, patient_contacts, patients,
      sessions, user_roles, role_permissions, permissions, roles, staff_profiles,
      departments, users
    RESTART IDENTITY CASCADE
  `);
  await db.execute(sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequencename LIKE 'caresync_seq_%'
      LOOP EXECUTE format('DROP SEQUENCE IF EXISTS %I', r.sequencename); END LOOP;
    END $$;
  `);

  /* ------------------------------------------------ roles & permissions -- */

  log('roles and permissions');
  const permissionCodes = [...new Set(Object.values(PERMISSIONS))];
  const permissionRows = await db.insert(s.permissions).values(
    permissionCodes.map((code) => {
      const [category, action] = code.split(':');
      return {
        code,
        label: `${action!.replace(/_/g, ' ')} ${category}`.replace(/\b\w/g, (c) => c.toUpperCase()),
        category: category!,
      };
    }),
  ).returning();
  const permissionByCode = new Map(permissionRows.map((p) => [p.code, p.id]));

  const roleRows = await db.insert(s.roles).values(
    ROLES.map((name) => ({ name, label: ROLE_LABELS[name], description: `${ROLE_LABELS[name]} role`, isSystem: true })),
  ).returning();
  const roleByName = new Map(roleRows.map((r) => [r.name, r.id]));

  await db.insert(s.rolePermissions).values(
    ROLES.flatMap((role) =>
      [...new Set(ROLE_PERMISSIONS[role])].map((code) => ({
        roleId: roleByName.get(role)!,
        permissionId: permissionByCode.get(code)!,
      })),
    ),
  );

  /* ------------------------------------------------------- departments --- */

  log('departments');
  const deptRows = await db.insert(s.departments).values([
    { code: 'GEN', name: 'General Medicine', description: 'General medical admissions and outpatient clinics' },
    { code: 'CARD', name: 'Cardiology', description: 'Cardiac care, catheter laboratory and coronary care unit' },
    { code: 'NEUR', name: 'Neurology', description: 'Neurological assessment and stroke care' },
    { code: 'ORTH', name: 'Orthopaedics', description: 'Trauma and elective orthopaedic surgery' },
    { code: 'EMER', name: 'Emergency', description: 'Emergency department and resuscitation' },
    { code: 'RESP', name: 'Respiratory Medicine', description: 'Respiratory assessment and ventilation support' },
    { code: 'RAD', name: 'Radiology', description: 'Diagnostic imaging', isClinical: true },
    { code: 'PATH', name: 'Pathology', description: 'Clinical laboratory services', isClinical: true },
    { code: 'PHAR', name: 'Pharmacy', description: 'Medicines management and dispensing', isClinical: true },
    { code: 'ADMIN', name: 'Hospital Administration', description: 'Operations, staffing and governance', isClinical: false },
  ]).returning();
  const dept = Object.fromEntries(deptRows.map((d) => [d.code, d]));

  /* ------------------------------------------------------ wards & beds --- */

  log('wards and beds');
  const wardRows = await db.insert(s.wards).values([
    { code: 'ICU', name: 'Intensive Care Unit', departmentId: dept.GEN!.id, floor: '3', isCritical: true },
    { code: 'CCU', name: 'Coronary Care Unit', departmentId: dept.CARD!.id, floor: '3', isCritical: true },
    { code: 'CARD-A', name: 'Cardiology Ward A', departmentId: dept.CARD!.id, floor: '2' },
    { code: 'GEN-B', name: 'General Ward B', departmentId: dept.GEN!.id, floor: '1' },
    { code: 'NEURO-C', name: 'Neurology Ward C', departmentId: dept.NEUR!.id, floor: '4' },
    { code: 'ORTH-D', name: 'Orthopaedic Ward D', departmentId: dept.ORTH!.id, floor: '4' },
    { code: 'RESP-E', name: 'Respiratory Ward E', departmentId: dept.RESP!.id, floor: '2' },
    { code: 'EMER-OBS', name: 'Emergency Observation', departmentId: dept.EMER!.id, floor: '0' },
  ]).returning();
  const ward = Object.fromEntries(wardRows.map((w) => [w.code, w]));

  const bedSpec: Array<[string, number]> = [
    ['ICU', 8], ['CCU', 8], ['CARD-A', 20], ['GEN-B', 24],
    ['NEURO-C', 16], ['ORTH-D', 16], ['RESP-E', 14], ['EMER-OBS', 10],
  ];
  const bedRows = await db.insert(s.beds).values(
    bedSpec.flatMap(([code, n]) =>
      Array.from({ length: n }, (_, i) => ({
        wardId: ward[code]!.id,
        code: `${code}-${String(i + 1).padStart(2, '0')}`,
      })),
    ),
  ).returning();
  const bedByCode = new Map(bedRows.map((b) => [b.code, b]));

  /* ------------------------------------------------------------ staff --- */

  log('staff accounts');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  type StaffSpec = {
    email: string; fullName: string; role: Role; deptCode: string;
    designation: string; specialization?: string; acceptsReferrals?: boolean; demo?: boolean;
  };

  const staffSpecs: StaffSpec[] = [
    // --- documented demo accounts -----------------------------------------
    { email: 'doctor@caresync.demo', fullName: 'Dr. Aarav Sharma', role: 'SENIOR_DOCTOR', deptCode: 'GEN', designation: 'Consultant Physician', specialization: 'Internal Medicine', acceptsReferrals: true, demo: true },
    { email: 'specialist@caresync.demo', fullName: 'Dr. Priya Mehta', role: 'SENIOR_DOCTOR', deptCode: 'CARD', designation: 'Consultant Cardiologist', specialization: 'Interventional Cardiology', acceptsReferrals: true, demo: true },
    { email: 'junior@caresync.demo', fullName: 'Dr. Kavya Iyer', role: 'JUNIOR_DOCTOR', deptCode: 'GEN', designation: 'Senior House Officer', specialization: 'Internal Medicine', acceptsReferrals: false, demo: true },
    { email: 'nurse@caresync.demo', fullName: 'Sister Meera Nair', role: 'NURSE', deptCode: 'GEN', designation: 'Senior Staff Nurse', demo: true },
    { email: 'radiology@caresync.demo', fullName: 'Dr. Rohan Desai', role: 'RADIOLOGY', deptCode: 'RAD', designation: 'Consultant Radiologist', specialization: 'Cross-sectional Imaging', demo: true },
    { email: 'pathology@caresync.demo', fullName: 'Dr. Ananya Bose', role: 'PATHOLOGY', deptCode: 'PATH', designation: 'Consultant Pathologist', specialization: 'Clinical Biochemistry', demo: true },
    { email: 'pharmacy@caresync.demo', fullName: 'Vikram Shah', role: 'PHARMACY', deptCode: 'PHAR', designation: 'Senior Clinical Pharmacist', demo: true },
    { email: 'admin@caresync.demo', fullName: 'Neha Kulkarni', role: 'HOSPITAL_ADMIN', deptCode: 'ADMIN', designation: 'Hospital Operations Manager', demo: true },
    { email: 'hr@caresync.demo', fullName: 'Sanjay Rao', role: 'HR_ADMIN', deptCode: 'ADMIN', designation: 'Head of Workforce', demo: true },

    // --- supporting cast so the hospital feels populated -------------------
    { email: 'sarah.jenkins@caresync.demo', fullName: 'Dr. Sarah Jenkins', role: 'SENIOR_DOCTOR', deptCode: 'GEN', designation: 'Consultant Intensivist', specialization: 'Critical Care', acceptsReferrals: true },
    { email: 'arjun.pillai@caresync.demo', fullName: 'Dr. Arjun Pillai', role: 'SENIOR_DOCTOR', deptCode: 'NEUR', designation: 'Consultant Neurologist', specialization: 'Stroke Medicine', acceptsReferrals: true },
    { email: 'leena.george@caresync.demo', fullName: 'Dr. Leena George', role: 'SENIOR_DOCTOR', deptCode: 'RESP', designation: 'Consultant Respiratory Physician', specialization: 'Interstitial Lung Disease', acceptsReferrals: true },
    { email: 'imran.qureshi@caresync.demo', fullName: 'Dr. Imran Qureshi', role: 'SENIOR_DOCTOR', deptCode: 'ORTH', designation: 'Consultant Orthopaedic Surgeon', specialization: 'Trauma Surgery', acceptsReferrals: true },
    { email: 'daniel.roy@caresync.demo', fullName: 'Dr. Daniel Roy', role: 'JUNIOR_DOCTOR', deptCode: 'CARD', designation: 'Cardiology Registrar', specialization: 'Cardiology', acceptsReferrals: false },
    { email: 'ritu.malhotra@caresync.demo', fullName: 'Sister Ritu Malhotra', role: 'NURSE', deptCode: 'CARD', designation: 'Charge Nurse' },
    { email: 'grace.thomas@caresync.demo', fullName: 'Nurse Grace Thomas', role: 'NURSE', deptCode: 'GEN', designation: 'Staff Nurse' },
  ];

  const userRows = await db.insert(s.users).values(
    staffSpecs.map((sp) => ({
      email: sp.email,
      passwordHash,
      fullName: sp.fullName,
      primaryRole: sp.role,
      isActive: true,
      lastLoginAt: sp.demo ? hoursAgo(2 + Math.random() * 20) : hoursAgo(24 + Math.random() * 120),
    })),
  ).returning();
  const user = Object.fromEntries(userRows.map((u) => [u.email, u]));

  await db.insert(s.staffProfiles).values(
    staffSpecs.map((sp, i) => ({
      userId: user[sp.email]!.id,
      staffNumber: `STF-2026-${String(i + 1).padStart(4, '0')}`,
      departmentId: dept[sp.deptCode]!.id,
      designation: sp.designation,
      specialization: sp.specialization ?? null,
      registrationNumber: sp.role.includes('DOCTOR') ? `MC-${100000 + i * 137}` : null,
      phone: `+91 98${String(10000000 + i * 4321).slice(0, 8)}`,
      acceptsReferrals: sp.acceptsReferrals ?? false,
    })),
  );

  await db.insert(s.userRoles).values(
    staffSpecs.map((sp) => ({ userId: user[sp.email]!.id, roleId: roleByName.get(sp.role)! })),
  );

  const drSharma = user['doctor@caresync.demo']!;
  const drMehta = user['specialist@caresync.demo']!;
  const drIyer = user['junior@caresync.demo']!;
  const nurseNair = user['nurse@caresync.demo']!;
  const drDesai = user['radiology@caresync.demo']!;
  const drBose = user['pathology@caresync.demo']!;
  const pharmShah = user['pharmacy@caresync.demo']!;
  const adminNeha = user['admin@caresync.demo']!;
  const drJenkins = user['sarah.jenkins@caresync.demo']!;
  const drPillai = user['arjun.pillai@caresync.demo']!;
  const drGeorge = user['leena.george@caresync.demo']!;
  const drQureshi = user['imran.qureshi@caresync.demo']!;
  const nurseMalhotra = user['ritu.malhotra@caresync.demo']!;

  /* ----------------------------------------------------- catalogue data -- */

  log('investigation catalogue and formulary');
  const investigationRows = await db.insert(s.investigations).values([
    { code: 'HB', name: 'Haemoglobin', category: 'LAB', panel: 'Full Blood Count', unit: 'g/dL', referenceLow: 13.0, referenceHigh: 17.0, criticalLow: 7.0, criticalHigh: 20.0 },
    { code: 'WBC', name: 'White Cell Count', category: 'LAB', panel: 'Full Blood Count', unit: 'x10^9/L', referenceLow: 4.0, referenceHigh: 11.0, criticalLow: 1.0, criticalHigh: 30.0 },
    { code: 'PLT', name: 'Platelet Count', category: 'LAB', panel: 'Full Blood Count', unit: 'x10^9/L', referenceLow: 150, referenceHigh: 400, criticalLow: 30, criticalHigh: 1000 },
    { code: 'NA', name: 'Sodium', category: 'LAB', panel: 'Urea and Electrolytes', unit: 'mmol/L', referenceLow: 135, referenceHigh: 145, criticalLow: 120, criticalHigh: 160 },
    { code: 'K', name: 'Potassium', category: 'LAB', panel: 'Urea and Electrolytes', unit: 'mmol/L', referenceLow: 3.5, referenceHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5 },
    { code: 'UREA', name: 'Urea', category: 'LAB', panel: 'Urea and Electrolytes', unit: 'mmol/L', referenceLow: 2.5, referenceHigh: 7.8, criticalHigh: 30 },
    { code: 'CREA', name: 'Creatinine', category: 'LAB', panel: 'Urea and Electrolytes', unit: 'umol/L', referenceLow: 60, referenceHigh: 110, criticalHigh: 400 },
    { code: 'TROP', name: 'Troponin I', category: 'LAB', panel: 'Cardiac Markers', unit: 'ng/L', referenceLow: 0, referenceHigh: 14, criticalHigh: 100 },
    { code: 'BNP', name: 'NT-proBNP', category: 'LAB', panel: 'Cardiac Markers', unit: 'pg/mL', referenceLow: 0, referenceHigh: 125, criticalHigh: 2000 },
    { code: 'CRP', name: 'C-Reactive Protein', category: 'LAB', panel: 'Inflammatory Markers', unit: 'mg/L', referenceLow: 0, referenceHigh: 5, criticalHigh: 200 },
    { code: 'GLU', name: 'Random Glucose', category: 'LAB', panel: 'Metabolic Panel', unit: 'mmol/L', referenceLow: 3.9, referenceHigh: 7.8, criticalLow: 2.5, criticalHigh: 25 },
    { code: 'HBA1C', name: 'HbA1c', category: 'LAB', panel: 'Metabolic Panel', unit: 'mmol/mol', referenceLow: 20, referenceHigh: 42 },
    { code: 'ALT', name: 'Alanine Transaminase', category: 'LAB', panel: 'Liver Function', unit: 'U/L', referenceLow: 7, referenceHigh: 56, criticalHigh: 1000 },
    { code: 'BILI', name: 'Total Bilirubin', category: 'LAB', panel: 'Liver Function', unit: 'umol/L', referenceLow: 3, referenceHigh: 21, criticalHigh: 100 },
    { code: 'INR', name: 'INR', category: 'LAB', panel: 'Coagulation', unit: 'ratio', referenceLow: 0.8, referenceHigh: 1.2, criticalHigh: 5 },
    { code: 'DDIM', name: 'D-Dimer', category: 'LAB', panel: 'Coagulation', unit: 'ng/mL', referenceLow: 0, referenceHigh: 500, criticalHigh: 5000 },
    { code: 'XR', name: 'Plain Radiograph', category: 'RADIOLOGY', panel: 'Imaging' },
    { code: 'CT', name: 'Computed Tomography', category: 'RADIOLOGY', panel: 'Imaging' },
    { code: 'MRI', name: 'Magnetic Resonance Imaging', category: 'RADIOLOGY', panel: 'Imaging' },
    { code: 'USS', name: 'Ultrasound', category: 'RADIOLOGY', panel: 'Imaging' },
  ]).returning();
  const inv = Object.fromEntries(investigationRows.map((i) => [i.code, i]));

  const medicationRows = await db.insert(s.medications).values([
    { code: 'ASP75', name: 'Aspirin', genericName: 'Acetylsalicylic acid', form: 'Tablet', strength: '75 mg', category: 'Antiplatelet' },
    { code: 'ATOR40', name: 'Atorvastatin', genericName: 'Atorvastatin', form: 'Tablet', strength: '40 mg', category: 'Statin' },
    { code: 'BISO25', name: 'Bisoprolol', genericName: 'Bisoprolol fumarate', form: 'Tablet', strength: '2.5 mg', category: 'Beta blocker' },
    { code: 'RAMI5', name: 'Ramipril', genericName: 'Ramipril', form: 'Capsule', strength: '5 mg', category: 'ACE inhibitor' },
    { code: 'FURO40', name: 'Furosemide', genericName: 'Furosemide', form: 'Tablet', strength: '40 mg', category: 'Loop diuretic' },
    { code: 'CLOP75', name: 'Clopidogrel', genericName: 'Clopidogrel', form: 'Tablet', strength: '75 mg', category: 'Antiplatelet' },
    { code: 'ENOX40', name: 'Enoxaparin', genericName: 'Enoxaparin sodium', form: 'Injection', strength: '40 mg', category: 'Anticoagulant' },
    { code: 'PARA500', name: 'Paracetamol', genericName: 'Paracetamol', form: 'Tablet', strength: '500 mg', category: 'Analgesic' },
    { code: 'OMEP20', name: 'Omeprazole', genericName: 'Omeprazole', form: 'Capsule', strength: '20 mg', category: 'Proton pump inhibitor' },
    { code: 'METF500', name: 'Metformin', genericName: 'Metformin hydrochloride', form: 'Tablet', strength: '500 mg', category: 'Antidiabetic' },
    { code: 'SALB100', name: 'Salbutamol', genericName: 'Salbutamol', form: 'Inhaler', strength: '100 mcg', category: 'Bronchodilator' },
    { code: 'AMOX500', name: 'Amoxicillin', genericName: 'Amoxicillin', form: 'Capsule', strength: '500 mg', category: 'Antibiotic' },
    { code: 'CEFT1G', name: 'Ceftriaxone', genericName: 'Ceftriaxone', form: 'Injection', strength: '1 g', category: 'Antibiotic' },
    { code: 'MORPH10', name: 'Morphine sulfate', genericName: 'Morphine', form: 'Injection', strength: '10 mg', category: 'Opioid analgesic' },
    { code: 'GTN500', name: 'Glyceryl trinitrate', genericName: 'GTN', form: 'Sublingual tablet', strength: '500 mcg', category: 'Nitrate' },
    { code: 'SPIR25', name: 'Spironolactone', genericName: 'Spironolactone', form: 'Tablet', strength: '25 mg', category: 'Aldosterone antagonist' },
  ]).returning();
  const med = Object.fromEntries(medicationRows.map((m) => [m.code, m]));

  /* --------------------------------------------------------- patients --- */

  log('patients, admissions and care teams');

  type PatientSpec = {
    number: string; first: string; last: string; dob: Date;
    gender: 'MALE' | 'FEMALE'; blood: (typeof s.bloodGroupEnum.enumValues)[number];
    allergies?: string[]; conditions?: string[];
    status: 'STABLE' | 'NEEDS_ATTENTION' | 'CRITICAL';
    wardCode: string; bedIndex: number; deptCode: string;
    attending: string; reason: string; admittedDaysAgo: number;
    team?: Array<{ userId: string; role: (typeof s.careTeamRoleEnum.enumValues)[number] }>;
  };

  const A = drSharma.id;
  const specs: PatientSpec[] = [
    { number: 'PT-2026-00142', first: 'Rahul', last: 'Mehta', dob: dob(1974, 3, 18), gender: 'MALE', blood: 'B_POSITIVE',
      allergies: ['Penicillin'], conditions: ['Hypertension', 'Type 2 diabetes'], status: 'CRITICAL',
      wardCode: 'ICU', bedIndex: 4, deptCode: 'GEN', attending: A,
      reason: 'Post-myocardial-infarction observation with ongoing chest discomfort', admittedDaysAgo: 3,
      team: [{ userId: drIyer.id, role: 'RESIDENT' }, { userId: nurseNair.id, role: 'PRIMARY_NURSE' }] },

    { number: 'PT-2026-00143', first: 'Anita', last: 'Rao', dob: dob(1980, 7, 2), gender: 'FEMALE', blood: 'O_POSITIVE',
      conditions: ['Anxiety'], status: 'NEEDS_ATTENTION',
      wardCode: 'GEN-B', bedIndex: 18, deptCode: 'GEN', attending: A,
      reason: 'Chest pain evaluation, awaiting ECG review', admittedDaysAgo: 1,
      team: [{ userId: nurseNair.id, role: 'PRIMARY_NURSE' }] },

    { number: 'PT-2026-00144', first: 'James', last: 'Dalton', dob: dob(1958, 11, 9), gender: 'MALE', blood: 'A_NEGATIVE',
      allergies: ['Sulfa drugs'], conditions: ['Chronic heart failure', 'Chronic kidney disease stage 3'], status: 'CRITICAL',
      wardCode: 'CCU', bedIndex: 2, deptCode: 'CARD', attending: A,
      reason: 'Acute decompensated heart failure, diuresis monitoring', admittedDaysAgo: 4,
      team: [{ userId: drMehta.id, role: 'SPECIALIST' }, { userId: nurseMalhotra.id, role: 'PRIMARY_NURSE' }] },

    { number: 'PT-2026-00145', first: 'Fatima', last: 'Sheikh', dob: dob(1991, 1, 27), gender: 'FEMALE', blood: 'AB_POSITIVE',
      conditions: ['Asthma'], status: 'NEEDS_ATTENTION',
      wardCode: 'RESP-E', bedIndex: 5, deptCode: 'RESP', attending: A,
      reason: 'Acute asthma exacerbation', admittedDaysAgo: 2,
      team: [{ userId: drGeorge.id, role: 'CONSULTING' }] },

    { number: 'PT-2026-00146', first: 'Suresh', last: 'Patel', dob: dob(1965, 5, 14), gender: 'MALE', blood: 'O_NEGATIVE',
      conditions: ['Hypertension'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 3, deptCode: 'GEN', attending: A,
      reason: 'Community acquired pneumonia', admittedDaysAgo: 5 },

    { number: 'PT-2026-00147', first: 'Elena', last: 'Fernandes', dob: dob(1949, 9, 30), gender: 'FEMALE', blood: 'A_POSITIVE',
      allergies: ['Codeine'], conditions: ['Osteoporosis'], status: 'STABLE',
      wardCode: 'ORTH-D', bedIndex: 7, deptCode: 'ORTH', attending: A,
      reason: 'Fractured neck of femur, post-operative recovery', admittedDaysAgo: 6,
      team: [{ userId: drQureshi.id, role: 'SPECIALIST' }] },

    { number: 'PT-2026-00148', first: 'Michael', last: 'Osei', dob: dob(1986, 4, 8), gender: 'MALE', blood: 'B_NEGATIVE',
      status: 'STABLE', wardCode: 'NEURO-C', bedIndex: 4, deptCode: 'NEUR', attending: A,
      reason: 'Investigation of recurrent syncope', admittedDaysAgo: 2,
      team: [{ userId: drPillai.id, role: 'CONSULTING' }] },

    { number: 'PT-2026-00149', first: 'Priyanka', last: 'Joshi', dob: dob(1996, 12, 3), gender: 'FEMALE', blood: 'O_POSITIVE',
      conditions: ['Migraine'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 9, deptCode: 'GEN', attending: A,
      reason: 'Severe dehydration secondary to gastroenteritis', admittedDaysAgo: 1 },

    { number: 'PT-2026-00150', first: 'Harold', last: 'Bennett', dob: dob(1943, 2, 21), gender: 'MALE', blood: 'A_POSITIVE',
      conditions: ['Atrial fibrillation', 'Hypertension'], status: 'STABLE',
      wardCode: 'CARD-A', bedIndex: 6, deptCode: 'CARD', attending: A,
      reason: 'Rate control for atrial fibrillation', admittedDaysAgo: 3,
      team: [{ userId: drMehta.id, role: 'SPECIALIST' }] },

    { number: 'PT-2026-00151', first: 'Deepa', last: 'Krishnan', dob: dob(1972, 8, 11), gender: 'FEMALE', blood: 'B_POSITIVE',
      allergies: ['Latex'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 12, deptCode: 'GEN', attending: A,
      reason: 'Cellulitis of the lower limb', admittedDaysAgo: 2 },

    { number: 'PT-2026-00152', first: 'Thomas', last: 'Whelan', dob: dob(1955, 6, 5), gender: 'MALE', blood: 'O_POSITIVE',
      conditions: ['COPD'], status: 'STABLE',
      wardCode: 'RESP-E', bedIndex: 9, deptCode: 'RESP', attending: A,
      reason: 'Infective exacerbation of COPD', admittedDaysAgo: 4 },

    { number: 'PT-2026-00153', first: 'Sana', last: 'Ahmed', dob: dob(1989, 10, 17), gender: 'FEMALE', blood: 'AB_NEGATIVE',
      status: 'STABLE', wardCode: 'GEN-B', bedIndex: 15, deptCode: 'GEN', attending: A,
      reason: 'Pyelonephritis', admittedDaysAgo: 3 },

    { number: 'PT-2026-00154', first: 'Gopal', last: 'Reddy', dob: dob(1961, 3, 2), gender: 'MALE', blood: 'A_POSITIVE',
      conditions: ['Type 2 diabetes'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 21, deptCode: 'GEN', attending: A,
      reason: 'Diabetic foot infection', admittedDaysAgo: 7 },

    { number: 'PT-2026-00155', first: 'Clara', last: 'Nwosu', dob: dob(1994, 5, 23), gender: 'FEMALE', blood: 'O_POSITIVE',
      status: 'STABLE', wardCode: 'EMER-OBS', bedIndex: 2, deptCode: 'EMER', attending: A,
      reason: 'Observation following head injury', admittedDaysAgo: 1 },

    { number: 'PT-2026-00156', first: 'Vijay', last: 'Menon', dob: dob(1978, 1, 30), gender: 'MALE', blood: 'B_POSITIVE',
      status: 'STABLE', wardCode: 'CARD-A', bedIndex: 11, deptCode: 'CARD', attending: A,
      reason: 'Investigation of exertional chest pain', admittedDaysAgo: 2 },

    { number: 'PT-2026-00157', first: 'Margaret', last: 'Hill', dob: dob(1951, 7, 19), gender: 'FEMALE', blood: 'A_NEGATIVE',
      conditions: ['Rheumatoid arthritis'], status: 'STABLE',
      wardCode: 'ORTH-D', bedIndex: 12, deptCode: 'ORTH', attending: A,
      reason: 'Elective total knee replacement', admittedDaysAgo: 5 },

    { number: 'PT-2026-00158', first: 'Aditya', last: 'Chauhan', dob: dob(1983, 9, 12), gender: 'MALE', blood: 'O_NEGATIVE',
      status: 'STABLE', wardCode: 'NEURO-C', bedIndex: 9, deptCode: 'NEUR', attending: A,
      reason: 'First seizure investigation', admittedDaysAgo: 3 },

    { number: 'PT-2026-00159', first: 'Beatrice', last: 'Okafor', dob: dob(1968, 11, 28), gender: 'FEMALE', blood: 'B_NEGATIVE',
      allergies: ['Iodinated contrast'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 6, deptCode: 'GEN', attending: A,
      reason: 'Anaemia investigation', admittedDaysAgo: 4 },

    { number: 'PT-2026-00160', first: 'Karan', last: 'Bhatia', dob: dob(2001, 2, 14), gender: 'MALE', blood: 'A_POSITIVE',
      status: 'STABLE', wardCode: 'ORTH-D', bedIndex: 3, deptCode: 'ORTH', attending: A,
      reason: 'Tibial shaft fracture, post fixation', admittedDaysAgo: 2 },

    { number: 'PT-2026-00161', first: 'Nadia', last: 'Hussain', dob: dob(1976, 6, 7), gender: 'FEMALE', blood: 'AB_POSITIVE',
      conditions: ['Hypothyroidism'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 2, deptCode: 'GEN', attending: A,
      reason: 'Symptomatic hyponatraemia', admittedDaysAgo: 3 },

    { number: 'PT-2026-00162', first: 'Peter', last: 'Lindqvist', dob: dob(1959, 4, 26), gender: 'MALE', blood: 'O_POSITIVE',
      status: 'STABLE', wardCode: 'CCU', bedIndex: 5, deptCode: 'CARD', attending: A,
      reason: 'Unstable angina, awaiting angiography', admittedDaysAgo: 1,
      team: [{ userId: drMehta.id, role: 'SPECIALIST' }] },

    { number: 'PT-2026-00163', first: 'Lakshmi', last: 'Subramanian', dob: dob(1947, 8, 3), gender: 'FEMALE', blood: 'B_POSITIVE',
      conditions: ['Dementia'], status: 'STABLE',
      wardCode: 'GEN-B', bedIndex: 23, deptCode: 'GEN', attending: A,
      reason: 'Urinary tract infection with delirium', admittedDaysAgo: 6 },

    { number: 'PT-2026-00164', first: 'Owen', last: 'Fitzgerald', dob: dob(1990, 12, 30), gender: 'MALE', blood: 'A_POSITIVE',
      status: 'STABLE', wardCode: 'EMER-OBS', bedIndex: 6, deptCode: 'EMER', attending: A,
      reason: 'Observation following anaphylaxis', admittedDaysAgo: 1 },

    { number: 'PT-2026-00165', first: 'Ishita', last: 'Banerjee', dob: dob(1985, 3, 9), gender: 'FEMALE', blood: 'O_POSITIVE',
      status: 'STABLE', wardCode: 'RESP-E', bedIndex: 2, deptCode: 'RESP', attending: A,
      reason: 'Pulmonary embolism, anticoagulated', admittedDaysAgo: 3 },

    // Patients under other consultants, so the hospital is not one doctor's caseload
    { number: 'PT-2026-00166', first: 'Ravi', last: 'Kulkarni', dob: dob(1970, 10, 21), gender: 'MALE', blood: 'B_POSITIVE',
      status: 'STABLE', wardCode: 'ICU', bedIndex: 1, deptCode: 'GEN', attending: drJenkins.id,
      reason: 'Post-operative critical care', admittedDaysAgo: 2 },
    { number: 'PT-2026-00167', first: 'Helen', last: 'Marsh', dob: dob(1963, 1, 5), gender: 'FEMALE', blood: 'A_POSITIVE',
      status: 'NEEDS_ATTENTION', wardCode: 'NEURO-C', bedIndex: 1, deptCode: 'NEUR', attending: drPillai.id,
      reason: 'Acute ischaemic stroke', admittedDaysAgo: 1 },
    { number: 'PT-2026-00168', first: 'Yusuf', last: 'Rahman', dob: dob(1955, 7, 15), gender: 'MALE', blood: 'O_POSITIVE',
      status: 'STABLE', wardCode: 'CARD-A', bedIndex: 1, deptCode: 'CARD', attending: drMehta.id,
      reason: 'Heart failure optimisation', admittedDaysAgo: 4 },
  ];

  const patientRows = await db.insert(s.patients).values(
    specs.map((p) => ({
      patientNumber: p.number,
      firstName: p.first,
      lastName: p.last,
      dateOfBirth: p.dob,
      gender: p.gender,
      bloodGroup: p.blood,
      phone: `+91 9${String(700000000 + Math.floor(Math.random() * 99999999)).slice(0, 9)}`,
      email: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.invalid`,
      addressLine: `${10 + Math.floor(Math.random() * 200)} Hospital Road`,
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      allergies: p.allergies ?? [],
      chronicConditions: p.conditions ?? [],
      status: p.status,
      createdById: adminNeha.id,
      createdAt: daysAgo(p.admittedDaysAgo + 1),
    })),
  ).returning();
  const patient = Object.fromEntries(patientRows.map((p) => [p.patientNumber, p]));

  await db.insert(s.patientContacts).values(
    specs.map((p) => ({
      patientId: patient[p.number]!.id,
      name: `${['Asha', 'Ramesh', 'Maria', 'John', 'Sunita'][Math.floor(Math.random() * 5)]} ${p.last}`,
      relationship: ['Spouse', 'Son', 'Daughter', 'Sibling', 'Parent'][Math.floor(Math.random() * 5)]!,
      phone: `+91 9${String(600000000 + Math.floor(Math.random() * 99999999)).slice(0, 9)}`,
      isPrimary: true,
    })),
  );

  const admissionRows = await db.insert(s.admissions).values(
    specs.map((p, i) => {
      const bedCode = `${p.wardCode}-${String(p.bedIndex).padStart(2, '0')}`;
      return {
        patientId: patient[p.number]!.id,
        admissionNumber: `ADM-2026-${String(i + 1).padStart(5, '0')}`,
        admissionDate: daysAgo(p.admittedDaysAgo),
        departmentId: dept[p.deptCode]!.id,
        wardId: ward[p.wardCode]!.id,
        bedId: bedByCode.get(bedCode)!.id,
        attendingDoctorId: p.attending,
        reason: p.reason,
        status: 'ADMITTED' as const,
        createdById: adminNeha.id,
      };
    }),
  ).returning();
  const admissionByPatient = new Map(admissionRows.map((a) => [a.patientId, a]));

  await db.update(s.beds)
    .set({ status: 'OCCUPIED' })
    .where(sql`${s.beds.id} IN (SELECT bed_id FROM admissions WHERE status = 'ADMITTED' AND bed_id IS NOT NULL)`);
  // A couple of beds mid-turnaround so the capacity board is not binary.
  await db.update(s.beds).set({ status: 'CLEANING' }).where(sql`${s.beds.code} IN ('GEN-B-24','ICU-08')`);
  await db.update(s.beds).set({ status: 'RESERVED' }).where(sql`${s.beds.code} IN ('CCU-08','CARD-A-20')`);

  const careTeamValues = specs.flatMap((p) => {
    const pid = patient[p.number]!.id;
    const adm = admissionByPatient.get(pid)!;
    return [
      { patientId: pid, admissionId: adm.id, userId: p.attending, role: 'ATTENDING' as const, assignedById: adminNeha.id, assignedAt: adm.admissionDate },
      ...(p.team ?? []).map((t) => ({
        patientId: pid, admissionId: adm.id, userId: t.userId, role: t.role, assignedById: p.attending, assignedAt: adm.admissionDate,
      })),
    ];
  });
  await db.insert(s.careTeamMembers).values(careTeamValues);

  const encounterRows = await db.insert(s.encounters).values(
    specs.flatMap((p) => {
      const pid = patient[p.number]!.id;
      const adm = admissionByPatient.get(pid)!;
      const base = {
        patientId: pid, admissionId: adm.id, departmentId: dept[p.deptCode]!.id,
        providerId: p.attending, status: 'IN_PROGRESS' as const,
      };
      return [
        { ...base, encounterType: 'INPATIENT' as const, reason: p.reason, startTime: adm.admissionDate },
        ...(p.admittedDaysAgo >= 2
          ? [{ ...base, encounterType: 'FOLLOW_UP' as const, reason: 'Consultant ward round', startTime: hoursAgo(3 + Math.random() * 5), status: 'COMPLETED' as const, endTime: hoursAgo(2) }]
          : []),
      ];
    }),
  ).returning();

  specs.forEach((p) => {
    const pid = patient[p.number]!.id;
    const adm = admissionByPatient.get(pid)!;
    pushEvent({
      patientId: pid, admissionId: adm.id, eventType: 'ADMISSION_CREATED',
      title: `Admitted - ${adm.admissionNumber}`, description: p.reason,
      actorId: adminNeha.id, departmentId: dept[p.deptCode]!.id,
      referenceType: 'admission', referenceId: adm.id, occurredAt: adm.admissionDate,
    });
  });

  /* ------------------------------------------------- vitals & nursing ---- */

  log('observation series, nursing notes and clinical notes');

  type VitalTemplate = { hr: number; sys: number; dia: number; spo2: number; temp: number; rr: number };
  const templateFor = (status: string): VitalTemplate =>
    status === 'CRITICAL' ? { hr: 118, sys: 92, dia: 58, spo2: 91, temp: 38.4, rr: 26 }
    : status === 'NEEDS_ATTENTION' ? { hr: 98, sys: 138, dia: 88, spo2: 95, temp: 37.6, rr: 20 }
    : { hr: 76, sys: 122, dia: 78, spo2: 98, temp: 36.8, rr: 16 };

  const jitter = (v: number, pct = 0.06) => Math.round(v * (1 + (Math.random() - 0.5) * pct * 2) * 10) / 10;

  const newsScore = (v: { hr: number; sys: number; spo2: number; temp: number; rr: number }) => {
    let n = 0;
    if (v.rr <= 8) n += 3; else if (v.rr <= 11) n += 1; else if (v.rr >= 25) n += 3; else if (v.rr >= 21) n += 2;
    if (v.spo2 <= 91) n += 3; else if (v.spo2 <= 93) n += 2; else if (v.spo2 <= 95) n += 1;
    if (v.temp <= 35) n += 3; else if (v.temp >= 39.1) n += 2; else if (v.temp >= 38.1) n += 1; else if (v.temp <= 36) n += 1;
    if (v.sys <= 90) n += 3; else if (v.sys <= 100) n += 2; else if (v.sys <= 110) n += 1; else if (v.sys >= 220) n += 3;
    if (v.hr <= 40) n += 3; else if (v.hr <= 50) n += 1; else if (v.hr >= 131) n += 3; else if (v.hr >= 111) n += 2; else if (v.hr >= 91) n += 1;
    return n;
  };

  const vitalsValues: (typeof s.vitalSigns.$inferInsert)[] = [];
  specs.forEach((p) => {
    const pid = patient[p.number]!.id;
    const adm = admissionByPatient.get(pid)!;
    const t = templateFor(p.status);
    const readings = p.status === 'CRITICAL' ? 12 : p.status === 'NEEDS_ATTENTION' ? 8 : 5;
    const recorder = p.deptCode === 'CARD' ? nurseMalhotra.id : nurseNair.id;

    for (let i = readings - 1; i >= 0; i--) {
      const drift = p.status === 'CRITICAL' ? 1 + i * 0.012 : 1;
      const v = {
        hr: Math.round(jitter(t.hr * drift)),
        sys: Math.round(jitter(t.sys / drift)),
        dia: Math.round(jitter(t.dia / drift)),
        spo2: Math.min(100, Math.round(jitter(t.spo2, 0.02))),
        temp: Math.round(jitter(t.temp, 0.02) * 10) / 10,
        rr: Math.round(jitter(t.rr)),
      };
      const score = newsScore(v);
      const recordedAt = hoursAgo(i * 4 + Math.random());
      vitalsValues.push({
        patientId: pid, admissionId: adm.id,
        temperatureC: v.temp, heartRate: v.hr,
        bloodPressureSystolic: v.sys, bloodPressureDiastolic: v.dia,
        spo2: v.spo2, respiratoryRate: v.rr,
        painScore: p.status === 'CRITICAL' ? 6 : 2,
        newsScore: score, isAbnormal: score >= 3,
        recordedById: recorder, recordedAt,
      });

      if (i < 3) {
        pushEvent({
          patientId: pid, admissionId: adm.id, eventType: 'VITALS_RECORDED',
          title: score >= 3 ? `Vitals recorded - review advised (score ${score})` : 'Vitals recorded',
          description: `BP ${v.sys}/${v.dia} mmHg, HR ${v.hr} bpm, SpO2 ${v.spo2}%, Temp ${v.temp} C`,
          actorId: recorder, departmentId: dept[p.deptCode]!.id,
          referenceType: 'vital_signs', severity: score >= 6 ? 'CRITICAL' : score >= 3 ? 'ATTENTION' : 'INFO',
          occurredAt: recordedAt,
        });
      }
    }
  });
  for (let i = 0; i < vitalsValues.length; i += 500) {
    await db.insert(s.vitalSigns).values(vitalsValues.slice(i, i + 500));
  }

  const observationValues = specs.slice(0, 12).map((p) => {
    const pid = patient[p.number]!.id;
    const adm = admissionByPatient.get(pid)!;
    const at = hoursAgo(2 + Math.random() * 6);
    const content = p.status === 'CRITICAL'
      ? 'Patient reports ongoing central chest discomfort. Appears clammy. Sitting upright, oxygen via nasal cannula at 2 L/min. Medical team informed.'
      : p.status === 'NEEDS_ATTENTION'
        ? 'Patient settled but anxious about results. Eating and drinking. Mobilising with one assistant.'
        : 'Comfortable at rest. Independent with personal care. No new concerns raised this shift.';
    pushEvent({
      patientId: pid, admissionId: adm.id, eventType: 'OBSERVATION_RECORDED',
      title: 'Nursing observation - General', description: content,
      actorId: nurseNair.id, departmentId: dept[p.deptCode]!.id,
      severity: p.status === 'CRITICAL' ? 'ATTENTION' : 'INFO', occurredAt: at,
    });
    return {
      patientId: pid, admissionId: adm.id, category: 'General',
      content, severity: (p.status === 'CRITICAL' ? 'ATTENTION' : 'INFO') as 'ATTENTION' | 'INFO',
      recordedById: nurseNair.id, recordedAt: at,
    };
  });
  await db.insert(s.observations).values(observationValues);

  const noteValues: (typeof s.clinicalNotes.$inferInsert)[] = [];
  specs.forEach((p, idx) => {
    const pid = patient[p.number]!.id;
    const adm = admissionByPatient.get(pid)!;
    const encounterId = encounterRows.find((e) => e.patientId === pid)?.id ?? null;

    noteValues.push({
      patientId: pid, admissionId: adm.id, encounterId,
      noteType: 'ADMISSION', title: 'Admission clerking',
      content:
        `PRESENTING COMPLAINT\n${p.reason}\n\n` +
        `HISTORY\n${p.conditions?.length ? `Background of ${p.conditions.join(', ')}.` : 'No significant past medical history recorded.'}\n` +
        `${p.allergies?.length ? `Known allergies: ${p.allergies.join(', ')}.` : 'No known drug allergies.'}\n\n` +
        `EXAMINATION\nAlert and orientated. Observations recorded on admission.\n\n` +
        `PLAN\nAdmit for assessment, baseline bloods, observations four hourly.`,
      authorId: drIyer.id, authorRole: 'JUNIOR_DOCTOR', departmentId: dept[p.deptCode]!.id,
      createdAt: adm.admissionDate, updatedAt: adm.admissionDate,
    });

    if (idx < 14) {
      const at = hoursAgo(4 + Math.random() * 8);
      noteValues.push({
        patientId: pid, admissionId: adm.id, encounterId,
        noteType: 'PROGRESS', title: 'Consultant ward round',
        content:
          `Reviewed on the consultant ward round.\n\n` +
          `${p.status === 'CRITICAL' ? 'Remains unwell. Observations show ongoing physiological derangement; escalated monitoring continued and specialist input requested.' : p.status === 'NEEDS_ATTENTION' ? 'Symptomatically improved but results still awaited. Continue current management and review after investigations.' : 'Making steady progress. Observations stable. Continue current plan and consider step-down.'}\n\n` +
          `PLAN\nContinue observations. Await outstanding investigations. Review tomorrow.`,
        authorId: p.attending, authorRole: 'SENIOR_DOCTOR', departmentId: dept[p.deptCode]!.id,
        createdAt: at, updatedAt: at,
      });
    }
  });
  const noteRows = await db.insert(s.clinicalNotes).values(noteValues).returning();

  await db.insert(s.clinicalNoteVersions).values(
    noteRows.map((n) => ({
      noteId: n.id, version: 1, title: n.title, content: n.content,
      authorId: n.authorId, changeNote: 'Initial version', createdAt: n.createdAt,
    })),
  );

  noteRows.forEach((n) => {
    pushEvent({
      patientId: n.patientId, admissionId: n.admissionId, eventType: 'CLINICAL_NOTE',
      title: `${n.noteType.charAt(0)}${n.noteType.slice(1).toLowerCase()} note - ${n.title}`,
      description: n.content.slice(0, 200), actorId: n.authorId,
      departmentId: n.departmentId, referenceType: 'clinical_note', referenceId: n.id,
      occurredAt: n.createdAt,
    });
  });

  /* --------------------------------------------------------- pathology --- */

  log('laboratory orders and results');

  type LabSpec = { patientNumber: string; panel: string; analytes: Array<[string, number]>; hoursAgo: number; completed: boolean };
  const labSpecs: LabSpec[] = [
    { patientNumber: 'PT-2026-00142', panel: 'Cardiac Markers', analytes: [['TROP', 780], ['BNP', 2400]], hoursAgo: 20, completed: true },
    { patientNumber: 'PT-2026-00142', panel: 'Urea and Electrolytes', analytes: [['NA', 136], ['K', 5.4], ['UREA', 9.2], ['CREA', 128]], hoursAgo: 8, completed: true },
    { patientNumber: 'PT-2026-00142', panel: 'Full Blood Count', analytes: [['HB', 12.1], ['WBC', 13.4], ['PLT', 260]], hoursAgo: 8, completed: true },
    { patientNumber: 'PT-2026-00144', panel: 'Urea and Electrolytes', analytes: [['NA', 132], ['K', 3.2], ['UREA', 14.1], ['CREA', 186]], hoursAgo: 6, completed: true },
    { patientNumber: 'PT-2026-00144', panel: 'Cardiac Markers', analytes: [['BNP', 3800], ['TROP', 22]], hoursAgo: 30, completed: true },
    { patientNumber: 'PT-2026-00143', panel: 'Cardiac Markers', analytes: [['TROP', 8]], hoursAgo: 10, completed: true },
    { patientNumber: 'PT-2026-00143', panel: 'Full Blood Count', analytes: [['HB', 13.4], ['WBC', 7.1], ['PLT', 310]], hoursAgo: 10, completed: true },
    { patientNumber: 'PT-2026-00145', panel: 'Inflammatory Markers', analytes: [['CRP', 64]], hoursAgo: 14, completed: true },
    { patientNumber: 'PT-2026-00146', panel: 'Inflammatory Markers', analytes: [['CRP', 128]], hoursAgo: 26, completed: true },
    { patientNumber: 'PT-2026-00146', panel: 'Full Blood Count', analytes: [['HB', 11.8], ['WBC', 16.2], ['PLT', 405]], hoursAgo: 26, completed: true },
    { patientNumber: 'PT-2026-00151', panel: 'Inflammatory Markers', analytes: [['CRP', 88]], hoursAgo: 18, completed: true },
    { patientNumber: 'PT-2026-00154', panel: 'Metabolic Panel', analytes: [['GLU', 14.2], ['HBA1C', 74]], hoursAgo: 22, completed: true },
    { patientNumber: 'PT-2026-00159', panel: 'Full Blood Count', analytes: [['HB', 8.4], ['WBC', 6.2], ['PLT', 340]], hoursAgo: 12, completed: true },
    { patientNumber: 'PT-2026-00161', panel: 'Urea and Electrolytes', analytes: [['NA', 124], ['K', 4.1], ['UREA', 4.8], ['CREA', 78]], hoursAgo: 16, completed: true },
    { patientNumber: 'PT-2026-00165', panel: 'Coagulation', analytes: [['DDIM', 3400], ['INR', 2.4]], hoursAgo: 28, completed: true },
    { patientNumber: 'PT-2026-00162', panel: 'Cardiac Markers', analytes: [['TROP', 45]], hoursAgo: 5, completed: true },
    { patientNumber: 'PT-2026-00148', panel: 'Full Blood Count', analytes: [], hoursAgo: 2, completed: false },
    { patientNumber: 'PT-2026-00152', panel: 'Inflammatory Markers', analytes: [], hoursAgo: 3, completed: false },
    { patientNumber: 'PT-2026-00157', panel: 'Coagulation', analytes: [], hoursAgo: 1, completed: false },
    { patientNumber: 'PT-2026-00163', panel: 'Urea and Electrolytes', analytes: [], hoursAgo: 4, completed: false },
    { patientNumber: 'PT-2026-00149', panel: 'Urea and Electrolytes', analytes: [], hoursAgo: 2, completed: false },
  ];

  const flagFor = (code: string, value: number) => {
    const c = inv[code]!;
    if (c.criticalLow != null && value <= c.criticalLow) return 'CRITICAL_LOW' as const;
    if (c.criticalHigh != null && value >= c.criticalHigh) return 'CRITICAL_HIGH' as const;
    if (c.referenceLow != null && value < c.referenceLow) return 'LOW' as const;
    if (c.referenceHigh != null && value > c.referenceHigh) return 'HIGH' as const;
    return 'NORMAL' as const;
  };

  const labOrderRows = await db.insert(s.investigationOrders).values(
    labSpecs.map((l, i) => {
      const pid = patient[l.patientNumber]!.id;
      const adm = admissionByPatient.get(pid)!;
      return {
        orderNumber: `LAB-2026-${String(i + 1).padStart(5, '0')}`,
        patientId: pid, admissionId: adm.id,
        category: 'LAB' as const, panel: l.panel,
        clinicalInfo: 'Routine inpatient monitoring',
        priority: (l.panel === 'Cardiac Markers' ? 'URGENT' : 'ROUTINE') as 'URGENT' | 'ROUTINE',
        status: (l.completed ? 'COMPLETED' : 'ORDERED') as 'COMPLETED' | 'ORDERED',
        departmentId: adm.departmentId,
        orderedById: adm.attendingDoctorId,
        orderedAt: hoursAgo(l.hoursAgo + 2),
        collectedAt: hoursAgo(l.hoursAgo + 1),
        completedAt: l.completed ? hoursAgo(l.hoursAgo) : null,
      };
    }),
  ).returning();

  const labResultValues: (typeof s.investigationResults.$inferInsert)[] = [];
  labSpecs.forEach((l, i) => {
    const order = labOrderRows[i]!;
    l.analytes.forEach(([code, value]) => {
      const c = inv[code]!;
      const flag = flagFor(code, value);
      labResultValues.push({
        orderId: order.id, patientId: order.patientId, investigationId: c.id,
        analyte: c.name, value: String(value), numericValue: value, unit: c.unit,
        referenceRange: c.referenceLow != null && c.referenceHigh != null ? `${c.referenceLow}-${c.referenceHigh} ${c.unit ?? ''}`.trim() : null,
        flag, resultedById: drBose.id, resultedAt: hoursAgo(l.hoursAgo),
      });
    });

    if (l.completed && l.analytes.length) {
      const abnormal = l.analytes.filter(([code, v]) => flagFor(code, v) !== 'NORMAL');
      const critical = l.analytes.filter(([code, v]) => flagFor(code, v).startsWith('CRITICAL'));
      pushEvent({
        patientId: order.patientId, admissionId: order.admissionId, eventType: 'LAB_RESULT',
        title: `${l.panel} results available`,
        description: abnormal.length ? `${abnormal.length} of ${l.analytes.length} values outside reference range` : `All ${l.analytes.length} values within reference range`,
        actorId: drBose.id, departmentId: dept.PATH!.id,
        referenceType: 'investigation_order', referenceId: order.id,
        severity: critical.length ? 'CRITICAL' : abnormal.length ? 'ATTENTION' : 'INFO',
        occurredAt: hoursAgo(l.hoursAgo),
      });
    } else {
      pushEvent({
        patientId: order.patientId, admissionId: order.admissionId, eventType: 'INVESTIGATION_ORDERED',
        title: `Lab order - ${l.panel}`, description: 'Awaiting laboratory processing',
        actorId: order.orderedById, departmentId: order.departmentId,
        referenceType: 'investigation_order', referenceId: order.id,
        occurredAt: hoursAgo(l.hoursAgo + 2),
      });
    }
  });
  await db.insert(s.investigationResults).values(labResultValues);

  /* --------------------------------------------------------- radiology --- */

  log('imaging studies and reports');

  type StudySpec = {
    patientNumber: string; modality: 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND';
    bodyPart: string; description: string; hoursAgo: number;
    report?: { findings: string; impression: string; critical?: boolean };
    status: 'ORDERED' | 'SCHEDULED' | 'IN_PROGRESS' | 'REPORTED';
  };

  const studySpecs: StudySpec[] = [
    { patientNumber: 'PT-2026-00142', modality: 'CT', bodyPart: 'Coronary arteries', description: 'CT coronary angiogram', hoursAgo: 18, status: 'REPORTED',
      report: { findings: 'Calcified and non-calcified plaque in the proximal left anterior descending artery with an estimated 70 per cent luminal narrowing. Remaining vessels show mild disease. No pericardial effusion.', impression: 'Significant proximal LAD stenosis. Correlate with functional testing and cardiology review.', critical: true } },
    { patientNumber: 'PT-2026-00144', modality: 'XRAY', bodyPart: 'Chest', description: 'Portable chest radiograph', hoursAgo: 30, status: 'REPORTED',
      report: { findings: 'Cardiomegaly with upper lobe venous diversion and small bilateral pleural effusions. No focal consolidation.', impression: 'Radiographic features of pulmonary venous congestion consistent with cardiac failure.' } },
    { patientNumber: 'PT-2026-00146', modality: 'XRAY', bodyPart: 'Chest', description: 'PA chest radiograph', hoursAgo: 48, status: 'REPORTED',
      report: { findings: 'Right lower zone consolidation with air bronchograms. No effusion. Heart size normal.', impression: 'Right lower lobe pneumonia.' } },
    { patientNumber: 'PT-2026-00148', modality: 'MRI', bodyPart: 'Brain', description: 'MRI brain with contrast', hoursAgo: 26, status: 'REPORTED',
      report: { findings: 'No acute infarct, haemorrhage or space-occupying lesion. Normal appearance of the ventricular system.', impression: 'Normal study.' } },
    { patientNumber: 'PT-2026-00165', modality: 'CT', bodyPart: 'Pulmonary arteries', description: 'CT pulmonary angiogram', hoursAgo: 36, status: 'REPORTED',
      report: { findings: 'Filling defects within the right lower lobe segmental pulmonary arteries. No right heart strain.', impression: 'Segmental pulmonary embolism, no evidence of right heart strain.', critical: true } },
    { patientNumber: 'PT-2026-00147', modality: 'XRAY', bodyPart: 'Right hip', description: 'Post-operative hip radiograph', hoursAgo: 60, status: 'REPORTED',
      report: { findings: 'Dynamic hip screw in satisfactory position. Fracture alignment maintained.', impression: 'Satisfactory post-operative appearances.' } },
    { patientNumber: 'PT-2026-00143', modality: 'XRAY', bodyPart: 'Chest', description: 'PA chest radiograph', hoursAgo: 4, status: 'IN_PROGRESS' },
    { patientNumber: 'PT-2026-00156', modality: 'CT', bodyPart: 'Coronary arteries', description: 'CT coronary angiogram', hoursAgo: 3, status: 'SCHEDULED' },
    { patientNumber: 'PT-2026-00167', modality: 'CT', bodyPart: 'Head', description: 'Non-contrast CT head', hoursAgo: 2, status: 'ORDERED' },
    { patientNumber: 'PT-2026-00158', modality: 'MRI', bodyPart: 'Brain', description: 'MRI brain epilepsy protocol', hoursAgo: 5, status: 'ORDERED' },
    { patientNumber: 'PT-2026-00160', modality: 'XRAY', bodyPart: 'Left tibia', description: 'Post-fixation tibia radiograph', hoursAgo: 6, status: 'ORDERED' },
  ];

  const radOrderRows = await db.insert(s.investigationOrders).values(
    studySpecs.map((st, i) => {
      const pid = patient[st.patientNumber]!.id;
      const adm = admissionByPatient.get(pid)!;
      return {
        orderNumber: `RAD-2026-${String(i + 1).padStart(5, '0')}`,
        patientId: pid, admissionId: adm.id, category: 'RADIOLOGY' as const,
        panel: `${st.modality} ${st.bodyPart}`, clinicalInfo: st.description,
        priority: 'ROUTINE' as const,
        status: (st.status === 'REPORTED' ? 'COMPLETED' : 'ORDERED') as 'COMPLETED' | 'ORDERED',
        departmentId: adm.departmentId, orderedById: adm.attendingDoctorId,
        orderedAt: hoursAgo(st.hoursAgo + 2),
        completedAt: st.status === 'REPORTED' ? hoursAgo(st.hoursAgo) : null,
      };
    }),
  ).returning();

  const studyRows = await db.insert(s.radiologyStudies).values(
    studySpecs.map((st, i) => {
      const pid = patient[st.patientNumber]!.id;
      const adm = admissionByPatient.get(pid)!;
      return {
        accessionNumber: `ACC-2026-${String(i + 1).padStart(5, '0')}`,
        patientId: pid, admissionId: adm.id, orderId: radOrderRows[i]!.id,
        modality: st.modality, bodyPart: st.bodyPart, description: st.description,
        clinicalInfo: st.description, contrastUsed: st.modality === 'CT' || st.modality === 'MRI',
        priority: 'ROUTINE' as const, status: st.status,
        requestedById: adm.attendingDoctorId,
        requestedAt: hoursAgo(st.hoursAgo + 2),
        performedAt: st.status === 'REPORTED' || st.status === 'IN_PROGRESS' ? hoursAgo(st.hoursAgo + 1) : null,
      };
    }),
  ).returning();

  const reportValues: (typeof s.radiologyReports.$inferInsert)[] = [];
  studySpecs.forEach((st, i) => {
    if (!st.report) return;
    const study = studyRows[i]!;
    reportValues.push({
      studyId: study.id, findings: st.report.findings, impression: st.report.impression,
      recommendation: st.report.critical ? 'Urgent clinical correlation and specialist review advised.' : null,
      isCritical: st.report.critical ?? false,
      radiologistId: drDesai.id, reportedAt: hoursAgo(st.hoursAgo),
    });
    pushEvent({
      patientId: study.patientId, admissionId: study.admissionId, eventType: 'RADIOLOGY_REPORT',
      title: `${st.modality} ${st.bodyPart} reported`, description: st.report.impression,
      actorId: drDesai.id, departmentId: dept.RAD!.id,
      referenceType: 'radiology_study', referenceId: study.id,
      severity: st.report.critical ? 'CRITICAL' : 'INFO', occurredAt: hoursAgo(st.hoursAgo),
    });
  });
  await db.insert(s.radiologyReports).values(reportValues);

  /* ---------------------------------------------------------- pharmacy --- */

  log('medication orders and administrations');

  type MedSpec = { patientNumber: string; code: string; dose: string; freq: string; route: (typeof s.medicationRouteEnum.enumValues)[number]; status: (typeof s.medicationStatusEnum.enumValues)[number] };
  const medSpecs: MedSpec[] = [
    { patientNumber: 'PT-2026-00142', code: 'ASP75', dose: '75 mg', freq: 'Once daily', route: 'ORAL', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00142', code: 'ATOR40', dose: '40 mg', freq: 'Once daily at night', route: 'ORAL', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00142', code: 'BISO25', dose: '2.5 mg', freq: 'Once daily', route: 'ORAL', status: 'ACTIVE' },
    { patientNumber: 'PT-2026-00142', code: 'GTN500', dose: '500 mcg', freq: 'As required', route: 'SUBLINGUAL', status: 'ACTIVE' },
    { patientNumber: 'PT-2026-00144', code: 'FURO40', dose: '40 mg', freq: 'Twice daily', route: 'IV', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00144', code: 'SPIR25', dose: '25 mg', freq: 'Once daily', route: 'ORAL', status: 'ACTIVE' },
    { patientNumber: 'PT-2026-00144', code: 'RAMI5', dose: '2.5 mg', freq: 'Once daily', route: 'ORAL', status: 'STOPPED' },
    { patientNumber: 'PT-2026-00143', code: 'PARA500', dose: '1 g', freq: 'Four times daily', route: 'ORAL', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00145', code: 'SALB100', dose: '2 puffs', freq: 'Four times daily', route: 'INHALATION', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00146', code: 'AMOX500', dose: '500 mg', freq: 'Three times daily', route: 'ORAL', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00151', code: 'CEFT1G', dose: '1 g', freq: 'Once daily', route: 'IV', status: 'PENDING_DISPENSING' },
    { patientNumber: 'PT-2026-00154', code: 'METF500', dose: '500 mg', freq: 'Twice daily', route: 'ORAL', status: 'ACTIVE' },
    { patientNumber: 'PT-2026-00165', code: 'ENOX40', dose: '80 mg', freq: 'Twice daily', route: 'SUBCUTANEOUS', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00147', code: 'PARA500', dose: '1 g', freq: 'Four times daily', route: 'ORAL', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00147', code: 'MORPH10', dose: '5 mg', freq: 'As required', route: 'IM', status: 'PENDING_DISPENSING' },
    { patientNumber: 'PT-2026-00150', code: 'BISO25', dose: '5 mg', freq: 'Once daily', route: 'ORAL', status: 'DISPENSED' },
    { patientNumber: 'PT-2026-00152', code: 'SALB100', dose: '2 puffs', freq: 'Four times daily', route: 'INHALATION', status: 'ACTIVE' },
    { patientNumber: 'PT-2026-00157', code: 'ENOX40', dose: '40 mg', freq: 'Once daily', route: 'SUBCUTANEOUS', status: 'PENDING_DISPENSING' },
    { patientNumber: 'PT-2026-00162', code: 'CLOP75', dose: '75 mg', freq: 'Once daily', route: 'ORAL', status: 'PENDING_DISPENSING' },
    { patientNumber: 'PT-2026-00159', code: 'OMEP20', dose: '20 mg', freq: 'Once daily', route: 'ORAL', status: 'ACTIVE' },
  ];

  const medOrderRows = await db.insert(s.medicationOrders).values(
    medSpecs.map((m) => {
      const pid = patient[m.patientNumber]!.id;
      const adm = admissionByPatient.get(pid)!;
      const dispensed = m.status === 'DISPENSED';
      return {
        patientId: pid, admissionId: adm.id, medicationId: med[m.code]!.id,
        medicineName: `${med[m.code]!.name} ${med[m.code]!.strength ?? ''}`.trim(),
        dose: m.dose, frequency: m.freq, route: m.route,
        instructions: m.route === 'ORAL' ? 'Take with food' : null,
        startDate: adm.admissionDate, prescriberId: adm.attendingDoctorId,
        status: m.status,
        stopReason: m.status === 'STOPPED' ? 'Held due to rising creatinine' : null,
        dispensedById: dispensed ? pharmShah.id : null,
        dispensedAt: dispensed ? hoursAgo(6 + Math.random() * 20) : null,
        createdAt: adm.admissionDate,
      };
    }),
  ).returning();

  medOrderRows.forEach((m) => {
    pushEvent({
      patientId: m.patientId, admissionId: m.admissionId, eventType: 'MEDICATION_ORDERED',
      title: `Prescribed ${m.medicineName} ${m.dose}`,
      description: `${m.frequency} | ${m.route}`,
      actorId: m.prescriberId, departmentId: dept.PHAR!.id,
      referenceType: 'medication_order', referenceId: m.id, occurredAt: m.createdAt,
    });
  });

  const administrations = medOrderRows
    .filter((m) => m.status === 'DISPENSED')
    .flatMap((m) => [0, 1].map((k) => ({
      medicationOrderId: m.id,
      administeredById: nurseNair.id,
      administeredAt: hoursAgo(4 + k * 8),
      doseGiven: m.dose,
      wasWithheld: false,
    })));
  if (administrations.length) await db.insert(s.medicationAdministrations).values(administrations);

  /* --------------------------------------------------------- referrals --- */

  log('referrals across every workflow state');

  const rahul = patient['PT-2026-00142']!;
  const rahulAdm = admissionByPatient.get(rahul.id)!;
  const dalton = patient['PT-2026-00144']!;
  const daltonAdm = admissionByPatient.get(dalton.id)!;

  type ReferralSpec = {
    number: string; patientNumber: string; from: string; to: string;
    fromDept: string; toDept: string; reason: string; summary: string;
    symptoms?: string; history?: string; investigations?: string; medications?: string;
    priority: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
    status: (typeof s.referralStatusEnum.enumValues)[number];
    createdHoursAgo: number;
    response?: { assessment: string; findings: string; recommendations: string; plan: string; followUp: string; final: boolean };
    informationRequest?: string;
  };

  const referralSpecs: ReferralSpec[] = [
    // The headline demo: pending, waiting for specialist@caresync.demo to act.
    { number: 'REF-2026-00001', patientNumber: 'PT-2026-00142', from: drSharma.id, to: drMehta.id,
      fromDept: 'GEN', toDept: 'CARD', priority: 'URGENT', status: 'PENDING', createdHoursAgo: 6,
      reason: 'Persistent chest pain and abnormal ECG',
      summary: '52-year-old man admitted three days ago following a myocardial infarction. Reports ongoing central chest discomfort despite antiplatelet and beta blocker therapy. Troponin I peaked at 780 ng/L. CT coronary angiogram demonstrates a 70 per cent proximal LAD stenosis. Blood pressure has been labile at 142/92 mmHg with a heart rate of 88 bpm.',
      symptoms: 'Central chest heaviness radiating to the left arm, worse on exertion. Associated shortness of breath. No syncope.',
      history: 'Hypertension for eight years, type 2 diabetes for four years. Ex-smoker, 20 pack years. Father had a myocardial infarction at 58.',
      investigations: 'Troponin I 780 ng/L (peak). NT-proBNP 2400 pg/mL. CT coronary angiogram: 70 per cent proximal LAD stenosis. Potassium 5.4 mmol/L, creatinine 128 umol/L.',
      medications: 'Aspirin 75 mg once daily, Atorvastatin 40 mg nightly, Bisoprolol 2.5 mg once daily, GTN 500 mcg as required.' },

    // A completed referral so the "specialist response" surface has real content.
    { number: 'REF-2026-00002', patientNumber: 'PT-2026-00144', from: drSharma.id, to: drMehta.id,
      fromDept: 'GEN', toDept: 'CARD', priority: 'URGENT', status: 'COMPLETED', createdHoursAgo: 60,
      reason: 'Acute decompensated heart failure with worsening renal function',
      summary: '68-year-old man with known chronic heart failure admitted with worsening breathlessness and peripheral oedema. NT-proBNP 3800 pg/mL. Creatinine has risen from a baseline of 120 to 186 umol/L on intravenous diuresis. Potassium 3.2 mmol/L.',
      symptoms: 'Orthopnoea, paroxysmal nocturnal dyspnoea, bilateral ankle swelling to mid-calf.',
      history: 'Chronic heart failure with reduced ejection fraction. Chronic kidney disease stage 3. Sulfa allergy.',
      investigations: 'Chest radiograph shows pulmonary venous congestion and small bilateral effusions. NT-proBNP 3800 pg/mL. Creatinine 186 umol/L.',
      medications: 'Furosemide 40 mg IV twice daily, Spironolactone 25 mg once daily. Ramipril held.',
      response: {
        assessment: 'Decompensated heart failure with cardiorenal syndrome type 1. The rise in creatinine reflects reduced renal perfusion rather than intrinsic renal injury, and the hypokalaemia is diuretic related.',
        findings: 'Elevated jugular venous pressure at 6 cm, bibasal crepitations, pitting oedema to mid-calf. Third heart sound present. Echocardiogram shows an ejection fraction of 32 per cent with moderate mitral regurgitation and no significant valvular stenosis.',
        recommendations: 'Continue intravenous diuresis but reduce to furosemide 40 mg once daily and monitor daily weights and urea and electrolytes. Replace potassium to keep above 4.0 mmol/L. Do not restart ramipril until creatinine plateaus. Consider sacubitril-valsartan once euvolaemic and renal function is stable.',
        plan: 'Furosemide 40 mg IV once daily. Potassium replacement 40 mmol daily. Daily weights and urea and electrolytes. Fluid restriction 1.5 litres. Repeat echocardiogram before discharge.',
        followUp: 'Cardiology clinic in two weeks with repeat urea and electrolytes at 72 hours. Heart failure nurse specialist to review before discharge.',
        final: true,
      } },

    // An accepted referral, mid-consultation.
    { number: 'REF-2026-00003', patientNumber: 'PT-2026-00145', from: drSharma.id, to: drGeorge.id,
      fromDept: 'GEN', toDept: 'RESP', priority: 'ROUTINE', status: 'ACCEPTED', createdHoursAgo: 20,
      reason: 'Poorly controlled asthma requiring specialist optimisation',
      summary: '35-year-old woman admitted with an acute asthma exacerbation, third presentation this year. CRP 64 mg/L. Currently on salbutamol only.',
      symptoms: 'Wheeze, nocturnal cough, reduced exercise tolerance.',
      history: 'Asthma since childhood. No previous intensive care admissions.',
      investigations: 'CRP 64 mg/L. Peak flow 58 per cent of predicted on admission.',
      medications: 'Salbutamol 100 mcg two puffs four times daily.' },

    // Awaiting information from the referring doctor.
    { number: 'REF-2026-00004', patientNumber: 'PT-2026-00148', from: drSharma.id, to: drPillai.id,
      fromDept: 'GEN', toDept: 'NEUR', priority: 'ROUTINE', status: 'REQUESTED_INFORMATION', createdHoursAgo: 30,
      reason: 'Recurrent syncope of unclear cause',
      summary: '40-year-old man with three episodes of syncope over six months. MRI brain reported as normal.',
      symptoms: 'Sudden loss of consciousness without warning, rapid recovery, no post-ictal confusion.',
      history: 'No significant past medical history.',
      investigations: 'MRI brain normal. Awaiting 24-hour tape.',
      medications: 'None.',
      informationRequest: 'Could you confirm whether a 12-lead ECG and lying and standing blood pressures have been recorded, and whether there is any family history of sudden cardiac death? That will determine whether this needs a cardiology or neurology pathway first.' },

    { number: 'REF-2026-00005', patientNumber: 'PT-2026-00147', from: drSharma.id, to: drQureshi.id,
      fromDept: 'GEN', toDept: 'ORTH', priority: 'ROUTINE', status: 'PENDING', createdHoursAgo: 10,
      reason: 'Post-operative mobilisation plan following hip fixation',
      summary: '76-year-old woman six days after dynamic hip screw fixation. Radiograph shows satisfactory position. Mobilising with a frame but limited by pain.',
      symptoms: 'Pain on weight bearing, limiting physiotherapy progress.',
      history: 'Osteoporosis. Codeine allergy.',
      investigations: 'Post-operative hip radiograph: satisfactory appearances.',
      medications: 'Paracetamol 1 g four times daily. Morphine 5 mg as required awaiting dispensing.' },

    { number: 'REF-2026-00006', patientNumber: 'PT-2026-00162', from: drSharma.id, to: drMehta.id,
      fromDept: 'GEN', toDept: 'CARD', priority: 'EMERGENCY', status: 'PENDING', createdHoursAgo: 2,
      reason: 'Unstable angina with rising troponin, urgent angiography needed',
      summary: '67-year-old man admitted yesterday with unstable angina. Troponin I has risen to 45 ng/L. Ongoing chest pain at rest despite nitrates.',
      symptoms: 'Rest chest pain, not fully relieved by GTN. Diaphoresis.',
      history: 'Hypertension. Smoker.',
      investigations: 'Troponin I 45 ng/L and rising. ECG shows dynamic T wave inversion in the anterior leads.',
      medications: 'Clopidogrel 75 mg once daily awaiting dispensing.' },

    { number: 'REF-2026-00007', patientNumber: 'PT-2026-00159', from: drSharma.id, to: drJenkins.id,
      fromDept: 'GEN', toDept: 'GEN', priority: 'ROUTINE', status: 'PENDING', createdHoursAgo: 14,
      reason: 'Symptomatic anaemia requiring transfusion decision',
      summary: '58-year-old woman with haemoglobin 8.4 g/dL and iodinated contrast allergy. Symptomatic on exertion.',
      symptoms: 'Fatigue and exertional breathlessness.',
      history: 'Iodinated contrast allergy.',
      investigations: 'Haemoglobin 8.4 g/dL, white cells 6.2, platelets 340.',
      medications: 'Omeprazole 20 mg once daily.' },

    { number: 'REF-2026-00008', patientNumber: 'PT-2026-00143', from: drIyer.id, to: drMehta.id,
      fromDept: 'GEN', toDept: 'CARD', priority: 'ROUTINE', status: 'DECLINED', createdHoursAgo: 40,
      reason: 'Chest pain with normal troponin',
      summary: '46-year-old woman with atypical chest pain. Troponin 8 ng/L, within reference range. ECG reported as normal.',
      symptoms: 'Sharp left-sided chest pain, worse on inspiration.',
      history: 'Anxiety.',
      investigations: 'Troponin 8 ng/L. Full blood count normal.',
      medications: 'Paracetamol 1 g four times daily.' },
  ];

  const referralRows = await db.insert(s.referrals).values(
    referralSpecs.map((r) => {
      const pid = patient[r.patientNumber]!.id;
      const adm = admissionByPatient.get(pid)!;
      const createdAt = hoursAgo(r.createdHoursAgo);
      const accepted = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status);
      return {
        referralNumber: r.number,
        patientId: pid, admissionId: adm.id,
        referringDoctorId: r.from, specialistDoctorId: r.to,
        fromDepartmentId: dept[r.fromDept]!.id, toDepartmentId: dept[r.toDept]!.id,
        reason: r.reason, clinicalSummary: r.summary,
        symptoms: r.symptoms ?? null, relevantHistory: r.history ?? null,
        relevantInvestigations: r.investigations ?? null, currentMedications: r.medications ?? null,
        priority: r.priority, status: r.status,
        informationRequest: r.informationRequest ?? null,
        declineReason: r.status === 'DECLINED' ? 'Troponin and ECG are reassuring; this does not require inpatient cardiology review. Please arrange outpatient follow-up if symptoms persist.' : null,
        createdAt, updatedAt: createdAt,
        acceptedAt: accepted ? hoursAgo(r.createdHoursAgo - 2) : null,
        respondedAt: r.response ? hoursAgo(r.createdHoursAgo - 6) : null,
        completedAt: r.status === 'COMPLETED' ? hoursAgo(r.createdHoursAgo - 5) : null,
      };
    }),
  ).returning();

  const responseValues: (typeof s.referralResponses.$inferInsert)[] = [];
  referralSpecs.forEach((r, i) => {
    const row = referralRows[i]!;
    const specialistName = staffSpecs.find((sp) => user[sp.email]!.id === r.to)?.fullName ?? 'the specialist';
    const referrerName = staffSpecs.find((sp) => user[sp.email]!.id === r.from)?.fullName ?? 'the referring doctor';

    pushEvent({
      patientId: row.patientId, admissionId: row.admissionId, eventType: 'REFERRAL_CREATED',
      title: `Referral to ${specialistName}`, description: r.reason,
      actorId: r.from, departmentId: dept[r.toDept]!.id,
      referenceType: 'referral', referenceId: row.id,
      severity: r.priority === 'EMERGENCY' ? 'CRITICAL' : r.priority === 'URGENT' ? 'ATTENTION' : 'INFO',
      occurredAt: row.createdAt,
    });

    if (row.acceptedAt) {
      pushEvent({
        patientId: row.patientId, admissionId: row.admissionId, eventType: 'REFERRAL_ACCEPTED',
        title: `${specialistName} accepted the referral`, description: `Referral ${r.number} accepted`,
        actorId: r.to, departmentId: dept[r.toDept]!.id,
        referenceType: 'referral', referenceId: row.id, occurredAt: row.acceptedAt,
      });
    }
    if (r.status === 'DECLINED') {
      pushEvent({
        patientId: row.patientId, admissionId: row.admissionId, eventType: 'REFERRAL_DECLINED',
        title: `${specialistName} declined the referral`, description: row.declineReason,
        actorId: r.to, departmentId: dept[r.toDept]!.id,
        referenceType: 'referral', referenceId: row.id, severity: 'ATTENTION',
        occurredAt: hoursAgo(r.createdHoursAgo - 3),
      });
    }
    if (r.informationRequest) {
      pushEvent({
        patientId: row.patientId, admissionId: row.admissionId, eventType: 'REFERRAL_INFORMATION_REQUESTED',
        title: `${specialistName} requested more information`, description: r.informationRequest,
        actorId: r.to, departmentId: dept[r.toDept]!.id,
        referenceType: 'referral', referenceId: row.id, severity: 'ATTENTION',
        occurredAt: hoursAgo(r.createdHoursAgo - 4),
      });
    }
    if (r.response) {
      responseValues.push({
        referralId: row.id,
        assessment: r.response.assessment, findings: r.response.findings,
        recommendations: r.response.recommendations, treatmentPlan: r.response.plan,
        followUp: r.response.followUp, authorId: r.to, isFinal: r.response.final,
        createdAt: row.respondedAt!, updatedAt: row.respondedAt!,
      });
      pushEvent({
        patientId: row.patientId, admissionId: row.admissionId, eventType: 'REFERRAL_RESPONSE',
        title: `Specialist response from ${specialistName}`, description: r.response.assessment,
        actorId: r.to, departmentId: dept[r.toDept]!.id,
        referenceType: 'referral', referenceId: row.id, occurredAt: row.respondedAt!,
      });
      if (row.completedAt) {
        pushEvent({
          patientId: row.patientId, admissionId: row.admissionId, eventType: 'REFERRAL_COMPLETED',
          title: `Referral ${r.number} completed`, description: `Specialist review closed by ${specialistName}`,
          actorId: r.to, departmentId: dept[r.toDept]!.id,
          referenceType: 'referral', referenceId: row.id, occurredAt: row.completedAt,
        });
      }
      // The specialist assessment also lands on the chart as a note.
      noteValues.length = 0;
      void referrerName;
    }
  });
  if (responseValues.length) await db.insert(s.referralResponses).values(responseValues);

  // Specialist notes for completed referrals, so the chart carries the response.
  const completedReferrals = referralSpecs
    .map((r, i) => ({ r, row: referralRows[i]! }))
    .filter(({ r }) => !!r.response);

  if (completedReferrals.length) {
    await db.insert(s.clinicalNotes).values(
      completedReferrals.map(({ r, row }) => ({
        patientId: row.patientId, admissionId: row.admissionId,
        noteType: 'SPECIALIST' as const,
        title: `Specialist consultation - referral ${r.number}`,
        content:
          `ASSESSMENT\n${r.response!.assessment}\n\nFINDINGS\n${r.response!.findings}\n\n` +
          `RECOMMENDATIONS\n${r.response!.recommendations}\n\nTREATMENT PLAN\n${r.response!.plan}\n\n` +
          `FOLLOW-UP\n${r.response!.followUp}`,
        authorId: r.to, authorRole: 'SENIOR_DOCTOR' as const,
        departmentId: dept[r.toDept]!.id,
        createdAt: row.respondedAt!, updatedAt: row.respondedAt!,
      })),
    );
  }

  // Accepting a referral grants the specialist scoped access to that patient.
  const grantable = referralSpecs
    .map((r, i) => ({ r, row: referralRows[i]! }))
    .filter(({ row }) => !!row.acceptedAt);

  if (grantable.length) {
    await db.insert(s.patientAccessGrants).values(
      grantable.map(({ r, row }) => ({
        patientId: row.patientId, userId: r.to, reason: 'REFERRAL' as const,
        justification: `Accepted referral ${r.number}`,
        referenceType: 'referral', referenceId: row.id,
        grantedById: r.from, createdAt: row.acceptedAt!,
      })),
    );
  }

  /* ---------------------------------------------------- notifications ---- */

  log('notifications, conversations and audit trail');

  const notificationValues: (typeof s.notifications.$inferInsert)[] = [];

  referralSpecs.forEach((r, i) => {
    const row = referralRows[i]!;
    const p = patientRows.find((x) => x.id === row.patientId)!;
    const referrerName = staffSpecs.find((sp) => user[sp.email]!.id === r.from)!.fullName;
    const specialistName = staffSpecs.find((sp) => user[sp.email]!.id === r.to)!.fullName;

    if (r.status === 'PENDING' || r.status === 'REQUESTED_INFORMATION') {
      notificationValues.push({
        recipientId: r.to, patientId: row.patientId, type: 'REFERRAL_CREATED',
        title: `New ${r.priority.toLowerCase()} referral`,
        message: `${referrerName} referred ${p.firstName} ${p.lastName} (${p.patientNumber}) to you - ${r.reason}`,
        referenceType: 'referral', referenceId: row.id, link: `/referrals/${row.id}`,
        severity: r.priority === 'EMERGENCY' ? 'CRITICAL' : r.priority === 'URGENT' ? 'ATTENTION' : 'INFO',
        read: false, createdAt: row.createdAt,
      });
    }
    if (r.status === 'COMPLETED') {
      notificationValues.push({
        recipientId: r.from, patientId: row.patientId, type: 'REFERRAL_COMPLETED',
        title: 'Referral completed',
        message: `${specialistName} completed the specialist review for ${p.firstName} ${p.lastName}. The response is on the patient record.`,
        referenceType: 'referral', referenceId: row.id, link: `/referrals/${row.id}`,
        read: false, createdAt: row.completedAt!,
      });
    }
    if (r.status === 'DECLINED') {
      notificationValues.push({
        recipientId: r.from, patientId: row.patientId, type: 'REFERRAL_DECLINED',
        title: 'Referral declined',
        message: `${specialistName} declined your referral for ${p.firstName} ${p.lastName}.`,
        referenceType: 'referral', referenceId: row.id, link: `/referrals/${row.id}`,
        severity: 'ATTENTION', read: true, readAt: hoursAgo(20), createdAt: hoursAgo(37),
      });
    }
    if (r.informationRequest) {
      notificationValues.push({
        recipientId: r.from, patientId: row.patientId, type: 'REFERRAL_INFORMATION_REQUESTED',
        title: 'More information requested',
        message: `${specialistName} needs more information for ${p.firstName} ${p.lastName}.`,
        referenceType: 'referral', referenceId: row.id, link: `/referrals/${row.id}`,
        severity: 'ATTENTION', read: false, createdAt: hoursAgo(r.createdHoursAgo - 4),
      });
    }
  });

  // Critical result notifications for the ordering clinician.
  notificationValues.push(
    {
      recipientId: drSharma.id, patientId: rahul.id, type: 'CRITICAL_LAB_RESULT',
      title: 'Critical laboratory result',
      message: 'Rahul Mehta: Troponin I 780 ng/L (critical high), NT-proBNP 2400 pg/mL (critical high)',
      referenceType: 'investigation_order', referenceId: labOrderRows[0]!.id,
      link: `/patients/${rahul.id}?tab=pathology`, severity: 'CRITICAL', read: false, createdAt: hoursAgo(20),
    },
    {
      recipientId: drSharma.id, patientId: rahul.id, type: 'RADIOLOGY_REPORT_AVAILABLE',
      title: 'Critical imaging finding',
      message: 'Rahul Mehta - CT Coronary arteries: Significant proximal LAD stenosis. Correlate with functional testing and cardiology review.',
      referenceType: 'radiology_study', referenceId: studyRows[0]!.id,
      link: `/patients/${rahul.id}?tab=radiology`, severity: 'CRITICAL', read: false, createdAt: hoursAgo(18),
    },
    {
      recipientId: drSharma.id, patientId: dalton.id, type: 'CRITICAL_LAB_RESULT',
      title: 'Critical laboratory result',
      message: 'James Dalton: NT-proBNP 3800 pg/mL (critical high)',
      referenceType: 'investigation_order', referenceId: labOrderRows[4]!.id,
      link: `/patients/${dalton.id}?tab=pathology`, severity: 'CRITICAL', read: false, createdAt: hoursAgo(30),
    },
    {
      recipientId: drSharma.id, patientId: patient['PT-2026-00165']!.id, type: 'RADIOLOGY_REPORT_AVAILABLE',
      title: 'Critical imaging finding',
      message: 'Ishita Banerjee - CT Pulmonary arteries: Segmental pulmonary embolism, no evidence of right heart strain.',
      referenceType: 'radiology_study', referenceId: studyRows[4]!.id,
      link: `/patients/${patient['PT-2026-00165']!.id}?tab=radiology`, severity: 'CRITICAL', read: false, createdAt: hoursAgo(36),
    },
    {
      recipientId: nurseNair.id, patientId: rahul.id, type: 'VITALS_RECORDED',
      title: 'Vitals need review',
      message: 'Rahul Mehta: BP 92/58 mmHg, HR 118 bpm, SpO2 91%',
      referenceType: 'vital_signs', link: `/patients/${rahul.id}?tab=vitals`,
      severity: 'ATTENTION', read: false, createdAt: hoursAgo(1),
    },
    {
      recipientId: pharmShah.id, patientId: patient['PT-2026-00151']!.id, type: 'MEDICATION_UPDATED',
      title: 'New medication awaiting dispensing',
      message: 'Ceftriaxone 1 g IV once daily for Deepa Krishnan.',
      referenceType: 'medication_order', link: '/pharmacy', read: false, createdAt: hoursAgo(5),
    },
  );

  await db.insert(s.notifications).values(notificationValues);

  const [conversation] = await db.insert(s.conversations).values({
    subject: 'Rahul Mehta - ECG and angiogram review',
    patientId: rahul.id,
    createdById: drSharma.id,
    lastMessageAt: hoursAgo(4),
  }).returning();

  await db.insert(s.conversationParticipants).values([
    { conversationId: conversation!.id, userId: drSharma.id, lastReadAt: hoursAgo(4) },
    { conversationId: conversation!.id, userId: drMehta.id },
    { conversationId: conversation!.id, userId: drIyer.id },
  ]);

  await db.insert(s.messages).values([
    { conversationId: conversation!.id, senderId: drSharma.id, body: 'Priya, could you review the latest ECG and the CT coronary angiogram for Mr Mehta in ICU-04? Troponin peaked at 780 and he is still symptomatic.', createdAt: hoursAgo(6) },
    { conversationId: conversation!.id, senderId: drMehta.id, body: 'Looking at it now. The proximal LAD lesion is significant. I have the referral open and will come up after my clinic list.', createdAt: hoursAgo(5) },
    { conversationId: conversation!.id, senderId: drIyer.id, body: 'Potassium is 5.4 this morning so we have held the ACE inhibitor. Repeat electrolytes are pending.', createdAt: hoursAgo(4) },
  ]);

  await flushTimeline();

  /* ------------------------------------------------------------- audit --- */

  const auditValues: (typeof s.auditLogs.$inferInsert)[] = [
    ...staffSpecs.slice(0, 9).map((sp) => ({
      userId: user[sp.email]!.id, actorEmail: sp.email, actorRole: sp.role,
      action: 'LOGIN', entityType: 'user', entityId: user[sp.email]!.id,
      ipAddress: '10.0.14.22', outcome: 'SUCCESS', createdAt: hoursAgo(8 + Math.random() * 12),
    })),
    ...referralSpecs.map((r, i) => ({
      userId: r.from,
      actorEmail: staffSpecs.find((sp) => user[sp.email]!.id === r.from)!.email,
      actorRole: staffSpecs.find((sp) => user[sp.email]!.id === r.from)!.role,
      action: 'REFERRAL_CREATED', entityType: 'referral', entityId: referralRows[i]!.id,
      patientId: referralRows[i]!.patientId, ipAddress: '10.0.14.22', outcome: 'SUCCESS',
      metadata: { referralNumber: r.number, priority: r.priority },
      createdAt: referralRows[i]!.createdAt,
    })),
    {
      userId: drBose.id, actorEmail: 'pathology@caresync.demo', actorRole: 'PATHOLOGY' as const,
      action: 'LAB_RESULT_CREATED', entityType: 'investigation_order', entityId: labOrderRows[0]!.id,
      patientId: rahul.id, outcome: 'SUCCESS', metadata: { count: 2, critical: 2 }, createdAt: hoursAgo(20),
    },
    {
      userId: drDesai.id, actorEmail: 'radiology@caresync.demo', actorRole: 'RADIOLOGY' as const,
      action: 'RADIOLOGY_REPORT_CREATED', entityType: 'radiology_report', entityId: studyRows[0]!.id,
      patientId: rahul.id, outcome: 'SUCCESS', metadata: { isCritical: true }, createdAt: hoursAgo(18),
    },
    {
      userId: drSharma.id, actorEmail: 'doctor@caresync.demo', actorRole: 'SENIOR_DOCTOR' as const,
      action: 'PATIENT_VIEWED', entityType: 'patient', entityId: rahul.id,
      patientId: rahul.id, outcome: 'SUCCESS', createdAt: hoursAgo(1),
    },
    {
      userId: adminNeha.id, actorEmail: 'admin@caresync.demo', actorRole: 'HOSPITAL_ADMIN' as const,
      action: 'USER_CREATED', entityType: 'user', entityId: drIyer.id,
      outcome: 'SUCCESS', metadata: { role: 'JUNIOR_DOCTOR' }, createdAt: daysAgo(20),
    },
  ];
  await db.insert(s.auditLogs).values(auditValues);

  /* -------------------------------------------- identifier continuity ---- */

  log('aligning identifier sequences');
  const seqStarts: Array<[string, number]> = [
    ['patient_2026', patientRows.length + 200],
    ['admission_2026', admissionRows.length + 1],
    ['referral_2026', referralRows.length + 1],
    ['lab_order_2026', labOrderRows.length + 1],
    ['rad_order_2026', radOrderRows.length + 1],
    ['accession_2026', studyRows.length + 1],
    ['staff_2026', staffSpecs.length + 1],
  ];
  for (const [name, start] of seqStarts) {
    await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS caresync_seq_${name} START ${start}`));
    await db.execute(sql.raw(`ALTER SEQUENCE caresync_seq_${name} RESTART WITH ${start}`));
  }

  /* -------------------------------------------------------------- done --- */

  const counts = (await db.execute<{ label: string; n: string }>(sql`
    SELECT 'patients' AS label, count(*)::text AS n FROM patients
    UNION ALL SELECT 'staff', count(*)::text FROM users
    UNION ALL SELECT 'admissions', count(*)::text FROM admissions
    UNION ALL SELECT 'beds', count(*)::text FROM beds
    UNION ALL SELECT 'vitals', count(*)::text FROM vital_signs
    UNION ALL SELECT 'clinical notes', count(*)::text FROM clinical_notes
    UNION ALL SELECT 'lab results', count(*)::text FROM investigation_results
    UNION ALL SELECT 'imaging studies', count(*)::text FROM radiology_studies
    UNION ALL SELECT 'medication orders', count(*)::text FROM medication_orders
    UNION ALL SELECT 'referrals', count(*)::text FROM referrals
    UNION ALL SELECT 'timeline events', count(*)::text FROM timeline_events
    UNION ALL SELECT 'notifications', count(*)::text FROM notifications
    UNION ALL SELECT 'audit entries', count(*)::text FROM audit_logs
  `)).rows as unknown as { label: string; n: string }[];

  console.log('\n  Seeded:');
  counts.forEach((c) => console.log(`    ${c.label.padEnd(20)} ${c.n}`));

  console.log('\n  Demo accounts (password for all: ' + DEMO_PASSWORD + ')');
  staffSpecs.filter((sp) => sp.demo).forEach((sp) => {
    console.log(`    ${sp.email.padEnd(30)} ${sp.role.padEnd(15)} ${sp.fullName}`);
  });
  console.log('\n  Headline demo: sign in as doctor@caresync.demo, open Rahul Mehta (PT-2026-00142),');
  console.log('  and refer him to Dr. Priya Mehta. Then sign in as specialist@caresync.demo to act on it.\n');
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (err) => {
    console.error('\nSeed failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
