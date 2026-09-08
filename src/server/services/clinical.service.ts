import '@/server/only';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  vitalSigns, observations, clinicalNotes, clinicalNoteVersions, users,
  admissions, patients, departments,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { recordTimelineEvent } from './timeline.service';
import { notify } from './notification.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';
import { MAX_PAGE_SIZE, MAX_REFERENCE_ROWS, boundedLimit } from '@/server/core/pagination';

/* ------------------------------------------------------------- vitals --- */

export type VitalsInput = {
  patientId: string;
  temperatureC?: number;
  heartRate?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  spo2?: number;
  respiratoryRate?: number;
  painScore?: number;
  bloodGlucose?: number;
  notes?: string;
};

/**
 * Simplified NEWS-style aggregate. Advisory only — it flags an observation set
 * for human review, it does not act on the patient.
 */
export function scoreVitals(v: VitalsInput): { score: number; abnormal: boolean; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const add = (points: number, why: string) => { score += points; reasons.push(why); };

  if (v.respiratoryRate != null) {
    if (v.respiratoryRate <= 8) add(3, 'Respiratory rate ≤ 8');
    else if (v.respiratoryRate <= 11) add(1, 'Respiratory rate 9–11');
    else if (v.respiratoryRate >= 25) add(3, 'Respiratory rate ≥ 25');
    else if (v.respiratoryRate >= 21) add(2, 'Respiratory rate 21–24');
  }
  if (v.spo2 != null) {
    if (v.spo2 <= 91) add(3, 'SpO₂ ≤ 91%');
    else if (v.spo2 <= 93) add(2, 'SpO₂ 92–93%');
    else if (v.spo2 <= 95) add(1, 'SpO₂ 94–95%');
  }
  if (v.temperatureC != null) {
    if (v.temperatureC <= 35) add(3, 'Temperature ≤ 35 °C');
    else if (v.temperatureC >= 39.1) add(2, 'Temperature ≥ 39.1 °C');
    else if (v.temperatureC >= 38.1) add(1, 'Temperature 38.1–39 °C');
    else if (v.temperatureC <= 36) add(1, 'Temperature 35.1–36 °C');
  }
  if (v.bloodPressureSystolic != null) {
    if (v.bloodPressureSystolic <= 90) add(3, 'Systolic BP ≤ 90 mmHg');
    else if (v.bloodPressureSystolic <= 100) add(2, 'Systolic BP 91–100 mmHg');
    else if (v.bloodPressureSystolic <= 110) add(1, 'Systolic BP 101–110 mmHg');
    else if (v.bloodPressureSystolic >= 220) add(3, 'Systolic BP ≥ 220 mmHg');
    else if (v.bloodPressureSystolic >= 160) add(1, 'Systolic BP ≥ 160 mmHg');
  }
  if (v.bloodPressureDiastolic != null && v.bloodPressureDiastolic >= 110) {
    add(1, 'Diastolic BP ≥ 110 mmHg');
  }
  if (v.heartRate != null) {
    if (v.heartRate <= 40) add(3, 'Heart rate ≤ 40 bpm');
    else if (v.heartRate <= 50) add(1, 'Heart rate 41–50 bpm');
    else if (v.heartRate >= 131) add(3, 'Heart rate ≥ 131 bpm');
    else if (v.heartRate >= 111) add(2, 'Heart rate 111–130 bpm');
    else if (v.heartRate >= 91) add(1, 'Heart rate 91–110 bpm');
  }

  return { score, abnormal: score >= 3, reasons };
}

export async function recordVitals(user: AuthUser, input: VitalsInput) {
  await assertPatientAccess(user, input.patientId);

  const [admission] = await db.select({ id: admissions.id, attendingDoctorId: admissions.attendingDoctorId, departmentId: admissions.departmentId })
    .from(admissions)
    .where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED')))
    .limit(1);

  const assessment = scoreVitals(input);

  const [vitals] = await db.insert(vitalSigns).values({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    temperatureC: input.temperatureC ?? null,
    heartRate: input.heartRate ?? null,
    bloodPressureSystolic: input.bloodPressureSystolic ?? null,
    bloodPressureDiastolic: input.bloodPressureDiastolic ?? null,
    spo2: input.spo2 ?? null,
    respiratoryRate: input.respiratoryRate ?? null,
    painScore: input.painScore ?? null,
    bloodGlucose: input.bloodGlucose ?? null,
    newsScore: assessment.score,
    isAbnormal: assessment.abnormal,
    notes: input.notes ?? null,
    recordedById: user.id,
  }).returning();

  const summary = [
    input.bloodPressureSystolic && input.bloodPressureDiastolic ? `BP ${input.bloodPressureSystolic}/${input.bloodPressureDiastolic} mmHg` : null,
    input.heartRate ? `HR ${input.heartRate} bpm` : null,
    input.spo2 ? `SpO₂ ${input.spo2}%` : null,
    input.temperatureC ? `Temp ${input.temperatureC} °C` : null,
  ].filter(Boolean).join(' • ');

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    eventType: 'VITALS_RECORDED',
    title: assessment.abnormal ? `Vitals recorded — review advised (score ${assessment.score})` : 'Vitals recorded',
    description: summary,
    actorId: user.id,
    departmentId: admission?.departmentId ?? user.departmentId,
    referenceType: 'vital_signs',
    referenceId: vitals!.id,
    severity: assessment.score >= 6 ? 'CRITICAL' : assessment.abnormal ? 'ATTENTION' : 'INFO',
    metadata: { newsScore: assessment.score, reasons: assessment.reasons },
  });

  if (assessment.abnormal && admission?.attendingDoctorId && admission.attendingDoctorId !== user.id) {
    const [patient] = await db.select().from(patients).where(eq(patients.id, input.patientId)).limit(1);
    await notify({
      recipientId: admission.attendingDoctorId,
      patientId: input.patientId,
      type: 'VITALS_RECORDED',
      title: assessment.score >= 6 ? 'Critical vitals recorded' : 'Vitals need review',
      message: `${patient!.firstName} ${patient!.lastName}: ${summary} (${assessment.reasons.join(', ')})`,
      referenceType: 'vital_signs',
      referenceId: vitals!.id,
      link: `/patients/${input.patientId}?tab=vitals`,
      severity: assessment.score >= 6 ? 'CRITICAL' : 'ATTENTION',
    });

    if (assessment.score >= 6) {
      await db.update(patients).set({ status: 'CRITICAL', updatedAt: new Date() }).where(eq(patients.id, input.patientId));
    } else {
      await db.update(patients).set({ status: 'NEEDS_ATTENTION', updatedAt: new Date() })
        .where(and(eq(patients.id, input.patientId), eq(patients.status, 'STABLE')));
    }
  }

  await recordAudit({
    action: AUDIT.VITALS_CREATED,
    entityType: 'vital_signs',
    entityId: vitals!.id,
    patientId: input.patientId,
    actor: user,
    metadata: { newsScore: assessment.score },
  });

  return { ...vitals!, assessment };
}

export async function listVitals(user: AuthUser, patientId: string, limit = 50) {
  await assertPatientAccess(user, patientId);
  return db
    .select({
      id: vitalSigns.id,
      temperatureC: vitalSigns.temperatureC,
      heartRate: vitalSigns.heartRate,
      bloodPressureSystolic: vitalSigns.bloodPressureSystolic,
      bloodPressureDiastolic: vitalSigns.bloodPressureDiastolic,
      spo2: vitalSigns.spo2,
      respiratoryRate: vitalSigns.respiratoryRate,
      painScore: vitalSigns.painScore,
      bloodGlucose: vitalSigns.bloodGlucose,
      newsScore: vitalSigns.newsScore,
      isAbnormal: vitalSigns.isAbnormal,
      notes: vitalSigns.notes,
      recordedAt: vitalSigns.recordedAt,
      recordedByName: users.fullName,
      recordedByRole: users.primaryRole,
    })
    .from(vitalSigns)
    .innerJoin(users, eq(users.id, vitalSigns.recordedById))
    .where(eq(vitalSigns.patientId, patientId))
    .orderBy(desc(vitalSigns.recordedAt))
    .limit(boundedLimit(limit, 50));
}

/* ------------------------------------------------------- observations --- */

export async function recordObservation(
  user: AuthUser,
  input: { patientId: string; category: string; content: string; severity?: 'INFO' | 'ATTENTION' | 'CRITICAL' },
) {
  await assertPatientAccess(user, input.patientId);

  const [admission] = await db.select({ id: admissions.id }).from(admissions)
    .where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED'))).limit(1);

  const [obs] = await db.insert(observations).values({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    category: input.category,
    content: input.content,
    severity: input.severity ?? 'INFO',
    recordedById: user.id,
  }).returning();

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    eventType: 'OBSERVATION_RECORDED',
    title: `Nursing observation — ${input.category}`,
    description: input.content,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'observation',
    referenceId: obs!.id,
    severity: input.severity ?? 'INFO',
  });

  await recordAudit({
    action: AUDIT.OBSERVATION_CREATED,
    entityType: 'observation',
    entityId: obs!.id,
    patientId: input.patientId,
    actor: user,
  });

  return obs!;
}

export async function listObservations(user: AuthUser, patientId: string, limit = 50) {
  await assertPatientAccess(user, patientId);
  return db
    .select({
      id: observations.id,
      category: observations.category,
      content: observations.content,
      severity: observations.severity,
      recordedAt: observations.recordedAt,
      recordedByName: users.fullName,
      recordedByRole: users.primaryRole,
    })
    .from(observations)
    .innerJoin(users, eq(users.id, observations.recordedById))
    .where(eq(observations.patientId, patientId))
    .orderBy(desc(observations.recordedAt))
    .limit(limit);
}

/* ---------------------------------------------------- clinical notes ---- */

export type NoteType = 'ADMISSION' | 'PROGRESS' | 'CONSULTATION' | 'NURSING' | 'SPECIALIST' | 'DISCHARGE';

export async function createClinicalNote(
  user: AuthUser,
  input: { patientId: string; noteType: NoteType; title: string; content: string; encounterId?: string },
) {
  await assertPatientAccess(user, input.patientId);

  if (user.role === 'NURSE' && input.noteType !== 'NURSING') {
    throw new AppError('INSUFFICIENT_PERMISSION', 'Nursing staff may only author nursing notes.');
  }

  const [admission] = await db.select({ id: admissions.id, departmentId: admissions.departmentId })
    .from(admissions)
    .where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED')))
    .limit(1);

  const note = await db.transaction(async (tx) => {
    const [row] = await tx.insert(clinicalNotes).values({
      patientId: input.patientId,
      admissionId: admission?.id ?? null,
      encounterId: input.encounterId ?? null,
      noteType: input.noteType,
      title: input.title,
      content: input.content,
      authorId: user.id,
      authorRole: user.role,
      departmentId: user.departmentId,
      version: 1,
    }).returning();

    await tx.insert(clinicalNoteVersions).values({
      noteId: row!.id, version: 1, title: input.title, content: input.content,
      authorId: user.id, changeNote: 'Initial version',
    });

    return row!;
  });

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    encounterId: input.encounterId ?? null,
    eventType: 'CLINICAL_NOTE',
    title: `${input.noteType.charAt(0)}${input.noteType.slice(1).toLowerCase()} note — ${input.title}`,
    description: input.content.slice(0, 240),
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'clinical_note',
    referenceId: note.id,
  });

  await recordAudit({
    action: AUDIT.NOTE_CREATED,
    entityType: 'clinical_note',
    entityId: note.id,
    patientId: input.patientId,
    actor: user,
    metadata: { noteType: input.noteType },
  });

  return note;
}

/**
 * Notes are versioned, never overwritten in place without a trace: the prior
 * text is preserved in `clinical_note_versions` and the version counter moves.
 */
export async function updateClinicalNote(
  user: AuthUser,
  noteId: string,
  input: { title?: string; content?: string; changeNote?: string },
) {
  const [note] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId)).limit(1);
  if (!note) throw new AppError('NOT_FOUND', 'Clinical note could not be found.');

  await assertPatientAccess(user, note.patientId);

  const isAuthor = note.authorId === user.id;
  const isSenior = user.role === 'SENIOR_DOCTOR' || user.role === 'SUPER_ADMIN';
  if (!isAuthor && !isSenior) {
    throw new AppError('FORBIDDEN', 'Only the author or a senior clinician can amend this note.');
  }

  const nextVersion = note.version + 1;
  const title = input.title ?? note.title;
  const content = input.content ?? note.content;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(clinicalNotes)
      .set({ title, content, version: nextVersion, updatedAt: new Date() })
      .where(eq(clinicalNotes.id, noteId))
      .returning();

    await tx.insert(clinicalNoteVersions).values({
      noteId, version: nextVersion, title, content,
      authorId: user.id, changeNote: input.changeNote ?? 'Amended',
    });

    return row!;
  });

  await recordAudit({
    action: AUDIT.NOTE_UPDATED,
    entityType: 'clinical_note',
    entityId: noteId,
    patientId: note.patientId,
    actor: user,
    metadata: { version: nextVersion, changeNote: input.changeNote },
  });

  return updated;
}

export async function listClinicalNotes(
  user: AuthUser,
  patientId: string,
  noteType?: NoteType,
  limit?: number,
) {
  await assertPatientAccess(user, patientId);
  const conditions = [eq(clinicalNotes.patientId, patientId), eq(clinicalNotes.isRetired, false)];
  if (noteType) conditions.push(eq(clinicalNotes.noteType, noteType));

  return db
    .select({
      id: clinicalNotes.id,
      noteType: clinicalNotes.noteType,
      title: clinicalNotes.title,
      content: clinicalNotes.content,
      version: clinicalNotes.version,
      createdAt: clinicalNotes.createdAt,
      updatedAt: clinicalNotes.updatedAt,
      authorId: users.id,
      authorName: users.fullName,
      authorRole: clinicalNotes.authorRole,
      departmentName: departments.name,
    })
    .from(clinicalNotes)
    .innerJoin(users, eq(users.id, clinicalNotes.authorId))
    .leftJoin(departments, eq(departments.id, clinicalNotes.departmentId))
    .where(and(...conditions))
    .orderBy(desc(clinicalNotes.createdAt))
    .limit(boundedLimit(limit, 100));
}

export async function getNoteVersions(user: AuthUser, noteId: string) {
  const [note] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId)).limit(1);
  if (!note) throw new AppError('NOT_FOUND', 'Clinical note could not be found.');
  await assertPatientAccess(user, note.patientId);

  return db
    .select({
      id: clinicalNoteVersions.id,
      version: clinicalNoteVersions.version,
      title: clinicalNoteVersions.title,
      content: clinicalNoteVersions.content,
      changeNote: clinicalNoteVersions.changeNote,
      createdAt: clinicalNoteVersions.createdAt,
      authorName: users.fullName,
    })
    .from(clinicalNoteVersions)
    .innerJoin(users, eq(users.id, clinicalNoteVersions.authorId))
    .where(eq(clinicalNoteVersions.noteId, noteId))
    .orderBy(desc(clinicalNoteVersions.version))
    .limit(MAX_PAGE_SIZE);
}

/** Vitals trend for sparklines — last N hours, oldest first. */
export async function vitalsTrend(user: AuthUser, patientId: string, hours = 72) {
  await assertPatientAccess(user, patientId);
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await db
    .select({
      recordedAt: vitalSigns.recordedAt,
      heartRate: vitalSigns.heartRate,
      systolic: vitalSigns.bloodPressureSystolic,
      diastolic: vitalSigns.bloodPressureDiastolic,
      spo2: vitalSigns.spo2,
      temperatureC: vitalSigns.temperatureC,
      newsScore: vitalSigns.newsScore,
    })
    .from(vitalSigns)
    .where(and(eq(vitalSigns.patientId, patientId), gte(vitalSigns.recordedAt, since)))
    .orderBy(vitalSigns.recordedAt)
    .limit(MAX_REFERENCE_ROWS);
  return rows;
}

export async function countAbnormalVitals(patientId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(vitalSigns)
    .where(and(eq(vitalSigns.patientId, patientId), eq(vitalSigns.isAbnormal, true)));
  return row?.count ?? 0;
}
