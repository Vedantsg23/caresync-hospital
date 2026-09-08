import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import { patients, notifications, auditLogs, users, referrals } from '@/server/db/schema';
import { getPatientHeader, searchPatients, updatePatient } from '@/server/services/patient.service';
import { getPatientTimeline } from '@/server/services/timeline.service';
import { listClinicalNotes, recordVitals, listVitals, createClinicalNote } from '@/server/services/clinical.service';
import { listLabOrders, createLabOrder, listRadiologyStudies } from '@/server/services/diagnostics.service';
import { listMedicationOrders, prescribeMedication } from '@/server/services/pharmacy.service';
import { getReferral, createReferral, acceptReferral, listReferrals } from '@/server/services/referral.service';
import { generateSummary } from '@/server/services/ai';
import { markRead, listNotifications } from '@/server/services/notification.service';
import { assertPatientAccess } from '@/server/services/patient-access.service';
import { approveAccount } from '@/server/services/registration.service';
import { AppError } from '@/server/core/errors';
import { prepareDatabase, actorFor, patientByNumber, ACCOUNTS, DEMO_PATIENT } from './helpers';
import type { AuthUser } from '@/server/auth/context';

/**
 * Security regressions.
 *
 * Every case here is an attack, not a feature. The question each one asks is
 * "what happens when a caller supplies an identifier they are not entitled
 * to?" — because that is the whole of IDOR, and knowing a UUID must never be
 * the same thing as being allowed to use it.
 */
describe('security: insecure direct object references', () => {
  let doctor: AuthUser;      // attending for the demo patient
  let specialist: AuthUser;  // unrelated to the neurology patient
  let nurse: AuthUser;
  let pathology: AuthUser;
  let hr: AuthUser;          // no clinical access at all
  let admin: AuthUser;

  let minePatientId: string;      // the doctor's own patient
  let othersPatientId: string;    // a patient under a different consultant
  let othersPatientNumber: string;

  beforeAll(async () => {
    prepareDatabase();
    [doctor, specialist, nurse, pathology, hr, admin] = await Promise.all([
      actorFor(ACCOUNTS.doctor), actorFor(ACCOUNTS.specialist), actorFor(ACCOUNTS.nurse),
      actorFor(ACCOUNTS.pathology), actorFor(ACCOUNTS.hr), actorFor(ACCOUNTS.admin),
    ]);
    minePatientId = (await patientByNumber(DEMO_PATIENT)).id;

    // A patient the specialist has no relationship to whatsoever.
    const other = await patientByNumber('PT-2026-00167');
    othersPatientId = other.id;
    othersPatientNumber = other.patientNumber;
  });

  afterAll(async () => { await pool.end(); });

  /* ------------------------------------------------ reading another record */

  describe('reading a record you have no relationship to', () => {
    /**
     * Every read path that takes a patient id. A gap in any one of these is a
     * gap in all of them, because an attacker only needs the weakest.
     */
    const readPaths: [string, (u: AuthUser, id: string) => Promise<unknown>][] = [
      ['patient header', (u, id) => getPatientHeader(u, id)],
      ['timeline', async (u, id) => { await assertPatientAccess(u, id); return getPatientTimeline({ patientId: id }); }],
      ['clinical notes', (u, id) => listClinicalNotes(u, id)],
      ['vitals', (u, id) => listVitals(u, id)],
      ['laboratory orders', (u, id) => listLabOrders({ patientId: id }, u)],
      ['radiology studies', (u, id) => listRadiologyStudies({ patientId: id }, u)],
      ['medication orders', (u, id) => listMedicationOrders({ patientId: id }, u)],
      ['AI summary', (u, id) => generateSummary(u, { patientId: id, kind: 'PATIENT_SUMMARY' })],
    ];

    for (const [label, call] of readPaths) {
      it(`refuses ${label} for an unrelated clinician`, async () => {
        await expect(call(specialist, othersPatientId)).rejects.toThrow(AppError);
      });

      it(`refuses ${label} for a role with no clinical access`, async () => {
        await expect(call(hr, minePatientId)).rejects.toThrow(AppError);
      });
    }

    it('refuses a patient id that does not exist, without leaking which', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      await expect(getPatientHeader(doctor, ghost)).rejects.toMatchObject({ status: 404 });
    });

    it('is not fooled by a well-formed but foreign identifier', async () => {
      // The classic attack: take a working request and change the id.
      await expect(getPatientHeader(doctor, minePatientId)).resolves.toBeTruthy();
      await expect(getPatientHeader(specialist, othersPatientId)).rejects.toThrow(AppError);
    });
  });

  /* ------------------------------------------------ writing to another record */

  describe('writing to a record you have no relationship to', () => {
    it('refuses to record vitals on an unrelated patient', async () => {
      await expect(recordVitals(specialist, { patientId: othersPatientId, heartRate: 80 }))
        .rejects.toThrow(AppError);
    });

    it('refuses to write a clinical note on an unrelated patient', async () => {
      await expect(createClinicalNote(specialist, {
        patientId: othersPatientId,
        noteType: 'PROGRESS', title: 'Injected', content: 'Should never be written.',
      })).rejects.toThrow(AppError);

      const notes = await listClinicalNotes(admin, othersPatientId);
      expect(notes.some((n) => n.title === 'Injected'), 'no note may have been created').toBe(false);
    });

    it('refuses to order an investigation for an unrelated patient', async () => {
      await expect(createLabOrder(specialist, {
        patientId: othersPatientId, panel: 'Full blood count',
      })).rejects.toThrow(AppError);
    });

    it('refuses to prescribe for an unrelated patient', async () => {
      await expect(prescribeMedication(specialist, {
        patientId: othersPatientId, medicineName: 'Paracetamol', dose: '1 g',
        frequency: 'QDS', route: 'ORAL', startDate: new Date(),
      })).rejects.toThrow(AppError);
    });

    it('refuses to amend demographics on an unrelated patient', async () => {
      await expect(updatePatient(specialist, othersPatientId, { city: 'Tampered' }))
        .rejects.toThrow(AppError);
    });

    it('refuses to refer a patient the referrer does not treat', async () => {
      await expect(createReferral(specialist, {
        patientId: othersPatientId,
        specialistDoctorId: doctor.id,
        reason: 'Fishing for access',
        clinicalSummary: 'Attempting to create a relationship that does not exist.',
      })).rejects.toThrow(AppError);
    });
  });

  /* ------------------------------------------------------ collection leakage */

  describe('collections do not leak what a caller may not open', () => {
    it('search cannot be used to enumerate by patient number', async () => {
      const result = await searchPatients(specialist, { q: othersPatientNumber });
      expect(result.items.map((p) => p.id)).not.toContain(othersPatientId);
      expect(result.total, 'the count must not reveal a hidden match').toBe(0);

      // Proof the record genuinely exists — otherwise the assertion is vacuous.
      const asAdmin = await searchPatients(admin, { q: othersPatientNumber });
      expect(asAdmin.items.map((p) => p.id)).toContain(othersPatientId);
    });

    it('a role with no clinical access sees an empty registry, not an error', async () => {
      const result = await searchPatients(hr, {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('a referral inbox contains only referrals the caller is party to', async () => {
      const radiologist = await actorFor(ACCOUNTS.radiology);
      const inbox = await listReferrals(radiologist, { box: 'all' });
      const all = await db.select({ id: referrals.id }).from(referrals);
      expect(all.length).toBeGreaterThan(0);
      expect(inbox.length).toBeLessThan(all.length);
    });

    it('notifications belong to their recipient only', async () => {
      const [someoneElses] = await db
        .select({ id: notifications.id, recipientId: notifications.recipientId })
        .from(notifications)
        .where(sql`${notifications.recipientId} <> ${nurse.id}`)
        .limit(1);
      expect(someoneElses).toBeDefined();

      // Marking another person's notification read must be a no-op, not a write.
      const changed = await markRead(nurse.id, someoneElses!.id);
      expect(changed).toBe(false);

      const [row] = await db.select().from(notifications).where(eq(notifications.id, someoneElses!.id));
      expect(row!.recipientId).toBe(someoneElses!.recipientId);

      const mine = await listNotifications({ userId: nurse.id, limit: 100 });
      expect(mine.items.every((n) => n.id !== someoneElses!.id)).toBe(true);
    });
  });

  /* ----------------------------------------------------- privilege escalation */

  describe('privilege escalation', () => {
    it('a hospital administrator cannot approve someone into an administrator role', async () => {
      const [pending] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.status} = 'PENDING_APPROVAL'`)
        .limit(1);

      if (pending) {
        await expect(approveAccount(
          { id: admin.id, email: admin.email, role: 'HOSPITAL_ADMIN' },
          { userId: pending.id, role: 'SUPER_ADMIN' },
        )).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });

    it('a nurse holds no prescribing or administrative permission', async () => {
      expect(nurse.permissions).not.toContain('medication:prescribe');
      expect(nurse.permissions).not.toContain('audit:read');
      expect(nurse.permissions).not.toContain('user:approve');
      expect(nurse.permissions).not.toContain('user:invite');
    });

    it('a diagnostic department cannot act outside its own discipline', async () => {
      expect(pathology.permissions).not.toContain('radiology:report');
      expect(pathology.permissions).not.toContain('medication:prescribe');
      expect(pathology.permissions).not.toContain('user:create');
    });

    it('a specialist cannot accept a referral addressed to someone else', async () => {
      const [foreign] = await db
        .select({ id: referrals.id })
        .from(referrals)
        .where(and(
          sql`${referrals.specialistDoctorId} <> ${specialist.id}`,
          eq(referrals.status, 'PENDING'),
        ))
        .limit(1);

      if (foreign) {
        await expect(acceptReferral(specialist, foreign.id)).rejects.toThrow(AppError);
      }
    });

    it('a referral cannot be read by a clinician who is not party to it', async () => {
      const pharmacy = await actorFor(ACCOUNTS.pharmacy);
      const [any] = await db.select({ id: referrals.id }).from(referrals).limit(1);
      await expect(getReferral(pharmacy, any!.id)).rejects.toThrow(AppError);
    });
  });

  /* ------------------------------------------------------------- audit trail */

  describe('denied access is recorded', () => {
    it('writes an audit row naming the caller, the patient and the address', async () => {
      const before = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
        .where(eq(auditLogs.action, 'PATIENT_ACCESS_DENIED'));

      await expect(assertPatientAccess(specialist, othersPatientId, {
        ipAddress: '203.0.113.9', userAgent: 'security-test',
      })).rejects.toThrow(AppError);

      const after = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
        .where(eq(auditLogs.action, 'PATIENT_ACCESS_DENIED'));
      expect(after[0]!.n).toBeGreaterThan(before[0]!.n);

      const [entry] = await db.select().from(auditLogs)
        .where(and(
          eq(auditLogs.action, 'PATIENT_ACCESS_DENIED'),
          eq(auditLogs.ipAddress, '203.0.113.9'),
        ))
        .limit(1);
      expect(entry!.outcome).toBe('DENIED');
      expect(entry!.patientId).toBe(othersPatientId);
      expect(entry!.userId).toBe(specialist.id);
    });

    it('the audit trail cannot be rewritten', async () => {
      const [entry] = await db.select().from(auditLogs).limit(1);
      await expect(
        db.update(auditLogs).set({ outcome: 'SUCCESS' }).where(eq(auditLogs.id, entry!.id)),
      ).rejects.toThrow();
      await expect(
        db.delete(auditLogs).where(eq(auditLogs.id, entry!.id)),
      ).rejects.toThrow();
    });
  });

  /* --------------------------------------------------------- input handling */

  describe('malformed input', () => {
    it('rejects a non-uuid identifier rather than passing it to SQL', async () => {
      await expect(getPatientHeader(doctor, "'; DROP TABLE patients; --")).rejects.toThrow();

      // The table is, of course, still there.
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(patients);
      expect(n).toBeGreaterThan(0);
    });

    it('treats a patient number as data, not as a query fragment', async () => {
      const result = await searchPatients(admin, { q: "%' OR '1'='1" });
      expect(result.items).toEqual([]);
    });
  });
});
