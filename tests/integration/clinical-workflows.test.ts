import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import {
  patients, admissions, beds, auditLogs, clinicalNotes, clinicalNoteVersions,
  timelineEvents, notifications, medicationOrders,
} from '@/server/db/schema';
import { recordVitals, createClinicalNote, updateClinicalNote, listVitals, getNoteVersions } from '@/server/services/clinical.service';
import { createLabOrder, recordLabResults, getPatientLabs, createRadiologyStudy, reportRadiologyStudy } from '@/server/services/diagnostics.service';
import { prescribeMedication, updateMedicationStatus, administerMedication } from '@/server/services/pharmacy.service';
import { transferPatient, dischargePatient, createAdmission, listWards, listBeds } from '@/server/services/admission.service';
import { changeRole, createStaff, setStaffActive, listAuditLogs } from '@/server/services/admin.service';
import { generateSummary, AI_REVIEW_BANNER } from '@/server/services/ai';
import { login } from '@/server/services/auth.service';
import { AppError } from '@/server/core/errors';
import { prepareDatabase, actorFor, patientByNumber, ACCOUNTS, DEMO_PATIENT } from './helpers';
import type { AuthUser } from '@/server/auth/context';

describe('clinical workflows', () => {
  let doctor: AuthUser;
  let nurse: AuthUser;
  let pathology: AuthUser;
  let radiology: AuthUser;
  let pharmacy: AuthUser;
  let admin: AuthUser;
  let patientId: string;

  beforeAll(async () => {
    prepareDatabase();
    [doctor, nurse, pathology, radiology, pharmacy, admin] = await Promise.all([
      actorFor(ACCOUNTS.doctor), actorFor(ACCOUNTS.nurse), actorFor(ACCOUNTS.pathology),
      actorFor(ACCOUNTS.radiology), actorFor(ACCOUNTS.pharmacy), actorFor(ACCOUNTS.admin),
    ]);
    patientId = (await patientByNumber(DEMO_PATIENT)).id;
  });

  afterAll(async () => { await pool.end(); });

  describe('observations', () => {
    it('scores, stores, timelines and audits a set of vitals', async () => {
      const before = (await listVitals(nurse, patientId)).length;

      const result = await recordVitals(nurse, {
        patientId, heartRate: 118, bloodPressureSystolic: 92, bloodPressureDiastolic: 58,
        spo2: 91, respiratoryRate: 26, temperatureC: 38.4, notes: 'Clammy, reports chest discomfort.',
      });

      expect(result.assessment.score).toBeGreaterThanOrEqual(6);
      expect(result.isAbnormal).toBe(true);
      expect(result.recordedById).toBe(nurse.id);

      const after = await listVitals(nurse, patientId);
      expect(after.length).toBe(before + 1);
      expect(after[0]!.recordedByName).toBe(nurse.fullName);

      const [event] = await db.select().from(timelineEvents)
        .where(and(eq(timelineEvents.patientId, patientId), eq(timelineEvents.eventType, 'VITALS_RECORDED')))
        .orderBy(desc(timelineEvents.occurredAt)).limit(1);
      expect(event!.severity).toBe('CRITICAL');

      const [audit] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'VITALS_CREATED'), eq(auditLogs.userId, nurse.id)))
        .orderBy(desc(auditLogs.createdAt)).limit(1);
      expect(audit).toBeDefined();
    });

    it('escalates the patient status and alerts the attending clinician', async () => {
      const [patient] = await db.select().from(patients).where(eq(patients.id, patientId));
      expect(patient!.status).toBe('CRITICAL');

      const [alert] = await db.select().from(notifications)
        .where(and(
          eq(notifications.recipientId, doctor.id),
          eq(notifications.type, 'VITALS_RECORDED'),
        )).orderBy(desc(notifications.createdAt)).limit(1);
      expect(alert, 'the attending clinician must be alerted').toBeDefined();
      expect(alert!.severity).toBe('CRITICAL');
    });

    it('does not escalate a normal set', async () => {
      const stable = await patientByNumber('PT-2026-00146');
      const result = await recordVitals(doctor, {
        patientId: stable.id, heartRate: 74, bloodPressureSystolic: 124,
        bloodPressureDiastolic: 78, spo2: 98, respiratoryRate: 16, temperatureC: 36.7,
      });
      expect(result.assessment.score).toBe(0);
      expect(result.isAbnormal).toBe(false);
    });
  });

  describe('clinical notes', () => {
    let noteId: string;

    it('records a note with author, role and department', async () => {
      const note = await createClinicalNote(doctor, {
        patientId, noteType: 'PROGRESS', title: 'Consultant review',
        content: 'ASSESSMENT\nStable overnight.\n\nPLAN\nContinue current management.',
      });
      noteId = note.id;
      expect(note.authorId).toBe(doctor.id);
      expect(note.authorRole).toBe('SENIOR_DOCTOR');
      expect(note.version).toBe(1);

      const [version] = await db.select().from(clinicalNoteVersions)
        .where(eq(clinicalNoteVersions.noteId, noteId));
      expect(version!.version).toBe(1);
      expect(version!.changeNote).toBe('Initial version');
    });

    it('versions an amendment instead of overwriting it', async () => {
      const updated = await updateClinicalNote(doctor, noteId, {
        content: 'ASSESSMENT\nStable overnight.\n\nPLAN\nStep down to the ward tomorrow.',
        changeNote: 'Plan updated after the ward round.',
      });
      expect(updated.version).toBe(2);

      const versions = await getNoteVersions(doctor, noteId);
      expect(versions).toHaveLength(2);
      expect(versions[0]!.version).toBe(2);
      // The original text is still retrievable.
      expect(versions[1]!.content).toContain('Continue current management');
      expect(versions[0]!.content).toContain('Step down');
    });

    it('restricts nursing staff to nursing notes', async () => {
      await expect(createClinicalNote(nurse, {
        patientId, noteType: 'PROGRESS', title: 'Not allowed', content: 'x',
      })).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' });

      const ok = await createClinicalNote(nurse, {
        patientId, noteType: 'NURSING', title: 'Nursing observation',
        content: 'Patient comfortable, mobilising with assistance.',
      });
      expect(ok.noteType).toBe('NURSING');
    });

    it('stops an unrelated clinician from amending someone else’s note', async () => {
      await expect(updateClinicalNote(pathology, noteId, { content: 'tampered' }))
        .rejects.toThrow(AppError);

      const [note] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId));
      expect(note!.content).not.toContain('tampered');
    });
  });

  describe('pathology', () => {
    it('flags results against reference ranges and escalates critical values', async () => {
      const order = await createLabOrder(doctor, {
        patientId, panel: 'Urea and Electrolytes', priority: 'URGENT',
        clinicalInfo: 'Monitoring on diuresis',
      });
      expect(order.status).toBe('ORDERED');

      const results = await recordLabResults(pathology, order.id, [
        { analyte: 'Potassium', value: '6.9', investigationCode: 'K' },
        { analyte: 'Sodium', value: '138', investigationCode: 'NA' },
        { analyte: 'Creatinine', value: '128', investigationCode: 'CREA' },
      ]);

      const byAnalyte = Object.fromEntries(results.map((r) => [r.analyte, r]));
      expect(byAnalyte.Potassium!.flag).toBe('CRITICAL_HIGH');
      expect(byAnalyte.Sodium!.flag).toBe('NORMAL');
      expect(byAnalyte.Creatinine!.flag).toBe('HIGH');
      expect(byAnalyte.Potassium!.referenceRange).toContain('3.5');

      const labs = await getPatientLabs(doctor, patientId);
      const thisOrder = labs.find((o) => o.id === order.id);
      expect(thisOrder!.status).toBe('COMPLETED');
      expect(thisOrder!.abnormalCount).toBe(2);

      const [alert] = await db.select().from(notifications)
        .where(and(
          eq(notifications.recipientId, doctor.id),
          eq(notifications.type, 'CRITICAL_LAB_RESULT'),
        )).orderBy(desc(notifications.createdAt)).limit(1);
      expect(alert, 'a critical value must alert the ordering clinician').toBeDefined();
      expect(alert!.message).toContain('Potassium');
      expect(alert!.severity).toBe('CRITICAL');
    });

    it('refuses to attach laboratory results to an imaging order', async () => {
      const study = await createRadiologyStudy(doctor, {
        patientId, modality: 'XRAY', bodyPart: 'Chest', description: 'Portable chest radiograph',
      });
      const [radOrder] = await db.execute<{ id: string }>(
        sql`SELECT order_id AS id FROM radiology_studies WHERE id = ${study.id}`,
      ).then((r) => r.rows as unknown as { id: string }[]);

      await expect(recordLabResults(pathology, radOrder!.id, [{ analyte: 'x', value: '1' }]))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('radiology', () => {
    it('publishes a report, timelines it and notifies the requester', async () => {
      const study = await createRadiologyStudy(doctor, {
        patientId, modality: 'CT', bodyPart: 'Chest', description: 'CT pulmonary angiogram',
        clinicalInfo: 'Query pulmonary embolism', contrastUsed: true, priority: 'URGENT',
      });
      expect(study.status).toBe('ORDERED');
      expect(study.accessionNumber).toMatch(/^ACC-\d{4}-\d{5}$/);

      const report = await reportRadiologyStudy(radiology, study.id, {
        findings: 'No filling defect in the pulmonary arteries. Lungs clear.',
        impression: 'No evidence of pulmonary embolism.',
      });
      expect(report.radiologistId).toBe(radiology.id);

      const [event] = await db.select().from(timelineEvents)
        .where(and(eq(timelineEvents.referenceId, study.id), eq(timelineEvents.eventType, 'RADIOLOGY_REPORT')))
        .limit(1);
      expect(event!.description).toContain('No evidence');

      const [alert] = await db.select().from(notifications)
        .where(and(
          eq(notifications.recipientId, doctor.id),
          eq(notifications.type, 'RADIOLOGY_REPORT_AVAILABLE'),
        )).orderBy(desc(notifications.createdAt)).limit(1);
      expect(alert).toBeDefined();
    });
  });

  describe('pharmacy', () => {
    it('blocks a prescription that collides with a recorded allergy', async () => {
      // The demo patient is allergic to penicillin.
      await expect(prescribeMedication(doctor, {
        patientId, medicineName: 'Penicillin V 500 mg', dose: '500 mg',
        frequency: 'Four times daily', route: 'ORAL', startDate: new Date(),
      })).rejects.toMatchObject({ code: 'CONFLICT' });

      const orders = await db.select().from(medicationOrders)
        .where(and(eq(medicationOrders.patientId, patientId), sql`${medicationOrders.medicineName} ILIKE '%penicillin%'`));
      expect(orders, 'nothing must be written when the interlock fires').toHaveLength(0);
    });

    it('runs the prescribe, dispense and administer chain with attribution', async () => {
      const order = await prescribeMedication(doctor, {
        patientId, medicineName: 'Ramipril 5 mg', dose: '2.5 mg',
        frequency: 'Once daily', route: 'ORAL', startDate: new Date(),
      });
      expect(order.status).toBe('PENDING_DISPENSING');
      expect(order.prescriberId).toBe(doctor.id);

      const dispensed = await updateMedicationStatus(pharmacy, order.id, { status: 'DISPENSED' });
      expect(dispensed.dispensedById).toBe(pharmacy.id);
      expect(dispensed.dispensedAt).not.toBeNull();

      const administration = await administerMedication(nurse, order.id, { doseGiven: '2.5 mg' });
      expect(administration.administeredById).toBe(nurse.id);
      expect(administration.wasWithheld).toBe(false);

      const stopped = await updateMedicationStatus(doctor, order.id, {
        status: 'STOPPED', stopReason: 'Potassium rising.',
      });
      expect(stopped.status).toBe('STOPPED');
      expect(stopped.stopReason).toBe('Potassium rising.');
    });

    it('requires a reason to stop a medication', async () => {
      const order = await prescribeMedication(doctor, {
        patientId, medicineName: 'Omeprazole 20 mg', dose: '20 mg',
        frequency: 'Once daily', route: 'ORAL', startDate: new Date(),
      });
      await expect(updateMedicationStatus(doctor, order.id, { status: 'STOPPED' }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('refuses to administer a medicine that is not dispensed or active', async () => {
      const order = await prescribeMedication(doctor, {
        patientId, medicineName: 'Metformin 500 mg', dose: '500 mg',
        frequency: 'Twice daily', route: 'ORAL', startDate: new Date(),
      });
      await expect(administerMedication(nurse, order.id, { doseGiven: '500 mg' }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('admissions, wards and beds', () => {
    it('moves bed occupancy on transfer and preserves the history', async () => {
      const patient = await patientByNumber('PT-2026-00149');
      const [admission] = await db.select().from(admissions)
        .where(and(eq(admissions.patientId, patient.id), eq(admissions.status, 'ADMITTED'))).limit(1);

      const originalBedId = admission!.bedId!;
      const wards = await listWards();
      const targetWard = wards.find((w) => w.code === 'CARD-A')!;
      const freeBeds = (await listBeds(targetWard.id)).filter((b) => b.status === 'AVAILABLE');
      const targetBed = freeBeds[0]!;

      await transferPatient(doctor, admission!.id, {
        toWardId: targetWard.id, toBedId: targetBed.id, reason: 'Cardiac monitoring required',
      });

      const [oldBed] = await db.select().from(beds).where(eq(beds.id, originalBedId));
      const [newBed] = await db.select().from(beds).where(eq(beds.id, targetBed.id));
      expect(oldBed!.status).toBe('CLEANING');
      expect(newBed!.status).toBe('OCCUPIED');

      const transfers = await db.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM admission_transfers WHERE admission_id = ${admission!.id}`,
      ).then((r) => (r.rows as unknown as { n: string }[])[0]!);
      expect(Number(transfers.n)).toBe(1);

      const [event] = await db.select().from(timelineEvents)
        .where(and(eq(timelineEvents.patientId, patient.id), eq(timelineEvents.eventType, 'PATIENT_TRANSFERRED')))
        .limit(1);
      expect(event!.title).toContain(targetWard.name);
    });

    it('frees the bed on discharge and closes the open encounters', async () => {
      const patient = await patientByNumber('PT-2026-00155');
      const [admission] = await db.select().from(admissions)
        .where(and(eq(admissions.patientId, patient.id), eq(admissions.status, 'ADMITTED'))).limit(1);
      const bedId = admission!.bedId!;

      const discharged = await dischargePatient(doctor, admission!.id, 'Observation complete, no concerns. Discharged home.');
      expect(discharged.status).toBe('DISCHARGED');
      expect(discharged.dischargeDate).not.toBeNull();

      const [bed] = await db.select().from(beds).where(eq(beds.id, bedId));
      expect(bed!.status).toBe('CLEANING');

      const open = await db.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM encounters WHERE admission_id = ${admission!.id} AND status = 'IN_PROGRESS'`,
      ).then((r) => (r.rows as unknown as { n: string }[])[0]!);
      expect(Number(open.n)).toBe(0);
    });

    it('refuses a second open admission for the same patient', async () => {
      const [existing] = await db.select().from(admissions)
        .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'ADMITTED'))).limit(1);
      expect(existing).toBeDefined();

      await expect(createAdmission(doctor, {
        patientId, departmentId: existing!.departmentId,
        attendingDoctorId: doctor.id, reason: 'Duplicate admission attempt',
      })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses to assign an occupied bed', async () => {
      const patient = await patientByNumber('PT-2026-00161');
      const [theirs] = await db.select().from(admissions)
        .where(and(eq(admissions.patientId, patient.id), eq(admissions.status, 'ADMITTED'))).limit(1);
      const occupied = (await listBeds()).find((b) => b.status === 'OCCUPIED' && b.id !== theirs!.bedId)!;

      await expect(transferPatient(doctor, theirs!.id, {
        toWardId: occupied.wardId, toBedId: occupied.id,
      })).rejects.toMatchObject({ code: 'BED_UNAVAILABLE' });
    });
  });

  describe('administration', () => {
    it('creates staff, changes a role, and audits both', async () => {
      const created = await createStaff(admin, {
        email: `registrar.${Date.now()}@caresync.demo`,
        fullName: 'Dr. Test Registrar',
        password: 'TestPassw0rd!',
        role: 'JUNIOR_DOCTOR',
        designation: 'Medical Registrar',
      });
      expect(created.staffNumber).toMatch(/^STF-\d{4}-\d{4}$/);

      const changed = await changeRole(admin, created.id, 'SENIOR_DOCTOR');
      expect(changed.previousRole).toBe('JUNIOR_DOCTOR');
      expect(changed.role).toBe('SENIOR_DOCTOR');

      const [audit] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'ROLE_CHANGED'), eq(auditLogs.entityId, created.id))).limit(1);
      expect(audit).toBeDefined();
      expect((audit!.metadata as Record<string, unknown>).to).toBe('SENIOR_DOCTOR');

      // A deactivated account can no longer sign in.
      await setStaffActive(admin, created.id, false);
      await expect(login({ email: created.email, password: 'TestPassw0rd!' }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('stops an administrator changing their own role', async () => {
      await expect(changeRole(admin, admin.id, 'NURSE')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('stops a non-super-admin minting a super administrator', async () => {
      await expect(createStaff(admin, {
        email: `escalate.${Date.now()}@caresync.demo`,
        fullName: 'Escalation Attempt',
        password: 'TestPassw0rd!',
        role: 'SUPER_ADMIN',
        designation: 'Nope',
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a weak password', async () => {
      await expect(createStaff(admin, {
        email: `weak.${Date.now()}@caresync.demo`,
        fullName: 'Weak Password',
        password: 'password',
        role: 'NURSE',
        designation: 'Staff Nurse',
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('audit trail', () => {
    it('is append-only at the database level', async () => {
      const [entry] = await db.select().from(auditLogs).limit(1);

      const causeOf = async (run: Promise<unknown>) => {
        try { await run; return null; } catch (err) {
          // Drizzle wraps the driver error; the trigger message is on the cause.
          const e = err as { cause?: { message?: string }; message?: string };
          return e.cause?.message ?? e.message ?? '';
        }
      };

      expect(await causeOf(db.execute(sql`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = ${entry!.id}`)))
        .toMatch(/append-only/i);
      expect(await causeOf(db.execute(sql`DELETE FROM audit_logs WHERE id = ${entry!.id}`)))
        .toMatch(/append-only/i);
    });

    it('can be filtered by patient and by action', async () => {
      const byPatient = await listAuditLogs({ patientId, limit: 50 });
      expect(byPatient.items.length).toBeGreaterThan(0);
      expect(byPatient.items.every((e) => e.patientId === patientId)).toBe(true);

      const logins = await listAuditLogs({ action: 'LOGIN', limit: 20 });
      expect(logins.items.every((e) => e.action === 'LOGIN')).toBe(true);
    });
  });

  describe('AI assistance', () => {
    it('produces an advisory summary from real record data and never mutates the chart', async () => {
      const notesBefore = await db.select({ n: sql<number>`count(*)::int` }).from(clinicalNotes)
        .where(eq(clinicalNotes.patientId, patientId));

      const summary = await generateSummary(doctor, { patientId, kind: 'PATIENT_SUMMARY' });

      expect(summary.banner).toBe(AI_REVIEW_BANNER);
      expect(summary.provider).toBe('heuristic');
      expect(summary.content).toContain('Rahul Mehta');
      expect(summary.content).toContain('Penicillin');
      expect(summary.keyPoints.length).toBeGreaterThan(0);

      const notesAfter = await db.select({ n: sql<number>`count(*)::int` }).from(clinicalNotes)
        .where(eq(clinicalNotes.patientId, patientId));
      expect(notesAfter[0]!.n, 'AI must not write clinical notes').toBe(notesBefore[0]!.n);

      const [audit] = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'AI_SUMMARY_GENERATED'))
        .orderBy(desc(auditLogs.createdAt)).limit(1);
      expect(audit!.userId).toBe(doctor.id);
    });

    it('refuses to summarise a patient the caller cannot see', async () => {
      const hr = await actorFor(ACCOUNTS.hr);
      await expect(generateSummary(hr, { patientId, kind: 'PATIENT_SUMMARY' }))
        .rejects.toMatchObject({ code: 'PATIENT_ACCESS_DENIED' });
    });
  });

  describe('authentication', () => {
    it('signs in a valid account and records the login', async () => {
      const result = await login({ email: ACCOUNTS.pathology, password: 'CareSync#2026' },
        { ipAddress: '10.0.0.5', userAgent: 'vitest' });
      expect(result.user.role).toBe('PATHOLOGY');
      expect(result.redirectTo).toBe('/pathology');
      expect(result.user.permissions).toContain('lab:result');
      expect(result.session.token, 'the service returns the session for the route to set').toBeTruthy();
      expect(result.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const unknown = await login({ email: 'ghost@caresync.demo', password: 'x' }).catch((e) => e);
      const wrong = await login({ email: ACCOUNTS.doctor, password: 'wrong-password' }).catch((e) => e);
      expect(unknown.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.message).toBe(wrong.message);
    });

    it('records a failed attempt in the audit trail', async () => {
      const [entry] = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'LOGIN_FAILED'))
        .orderBy(desc(auditLogs.createdAt)).limit(1);
      expect(entry).toBeDefined();
      expect(entry!.outcome).toBe('FAILURE');
    });
  });
});
