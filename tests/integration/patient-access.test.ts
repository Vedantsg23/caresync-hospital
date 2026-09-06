import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import { auditLogs, patients } from '@/server/db/schema';
import {
  evaluatePatientAccess, assertPatientAccess, grantPatientAccess,
} from '@/server/services/patient-access.service';
import { searchPatients, getPatientHeader } from '@/server/services/patient.service';
import { AppError } from '@/server/core/errors';
import { prepareDatabase, actorFor, patientByNumber, ACCOUNTS, DEMO_PATIENT } from './helpers';
import type { AuthUser } from '@/server/auth/context';

/**
 * Authorization is the property this system most needs to get right.
 * These tests prove that knowing a patient's ID is never enough.
 */
describe('patient-level access control', () => {
  let doctor: AuthUser;      // attending clinician for the demo patients
  let specialist: AuthUser;  // cardiologist, party to some referrals
  let nurse: AuthUser;       // general medicine ward nurse
  let radiology: AuthUser;
  let pathology: AuthUser;
  let pharmacy: AuthUser;
  let hr: AuthUser;          // no clinical access at all
  let admin: AuthUser;       // hospital-wide oversight

  let demoPatientId: string;
  let otherConsultantsPatientId: string;

  beforeAll(async () => {
    prepareDatabase();
    [doctor, specialist, nurse, radiology, pathology, pharmacy, hr, admin] = await Promise.all([
      actorFor(ACCOUNTS.doctor), actorFor(ACCOUNTS.specialist), actorFor(ACCOUNTS.nurse),
      actorFor(ACCOUNTS.radiology), actorFor(ACCOUNTS.pathology), actorFor(ACCOUNTS.pharmacy),
      actorFor(ACCOUNTS.hr), actorFor(ACCOUNTS.admin),
    ]);
    demoPatientId = (await patientByNumber(DEMO_PATIENT)).id;
    // PT-2026-00167 is admitted under Dr. Pillai in Neurology - nothing to do with Dr. Sharma.
    otherConsultantsPatientId = (await patientByNumber('PT-2026-00167')).id;
  });

  afterAll(async () => { await pool.end(); });

  describe('who may open a record', () => {
    it('allows the attending doctor', async () => {
      const d = await evaluatePatientAccess(doctor, demoPatientId);
      expect(d).toEqual({ allowed: true, reason: 'ATTENDING_DOCTOR' });
    });

    it('allows a hospital administrator hospital-wide', async () => {
      expect((await evaluatePatientAccess(admin, demoPatientId)).reason).toBe('OVERSIGHT_ROLE');
      expect((await evaluatePatientAccess(admin, otherConsultantsPatientId)).allowed).toBe(true);
    });

    it('allows a nurse only on their own department’s admitted patients', async () => {
      const own = await evaluatePatientAccess(nurse, demoPatientId);
      expect(own.allowed).toBe(true);
      expect(['CARE_TEAM', 'WARD_NURSE']).toContain(own.reason);

      // Neurology patient, not general medicine.
      const other = await evaluatePatientAccess(nurse, otherConsultantsPatientId);
      expect(other.allowed).toBe(false);
    });

    it('allows a diagnostic department only where an order reached them', async () => {
      // The demo patient has both laboratory orders and imaging.
      expect((await evaluatePatientAccess(pathology, demoPatientId)).reason).toBe('DIAGNOSTIC_ORDER');
      expect((await evaluatePatientAccess(radiology, demoPatientId)).reason).toBe('DIAGNOSTIC_ORDER');
      expect((await evaluatePatientAccess(pharmacy, demoPatientId)).reason).toBe('DIAGNOSTIC_ORDER');

      // The stroke patient has no laboratory order in the seed, so pathology has none.
      const noLab = await evaluatePatientAccess(pathology, otherConsultantsPatientId);
      expect(noLab.allowed).toBe(false);
    });

    it('refuses a workforce administrator entirely', async () => {
      expect((await evaluatePatientAccess(hr, demoPatientId)).allowed).toBe(false);
      expect((await evaluatePatientAccess(hr, otherConsultantsPatientId)).allowed).toBe(false);
      expect(hr.permissions).not.toContain('patient:read');
    });

    it('refuses a doctor with no relationship to the patient', async () => {
      const decision = await evaluatePatientAccess(specialist, otherConsultantsPatientId);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('DENIED');
    });
  });

  describe('assertPatientAccess', () => {
    it('throws a 403 and audits the denial', async () => {
      const before = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
        .where(eq(auditLogs.action, 'PATIENT_ACCESS_DENIED'));

      await expect(
        assertPatientAccess(hr, demoPatientId, { ipAddress: '10.0.0.9', userAgent: 'test' }),
      ).rejects.toMatchObject({ code: 'PATIENT_ACCESS_DENIED', status: 403 });

      const after = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
        .where(eq(auditLogs.action, 'PATIENT_ACCESS_DENIED'));
      expect(after[0]!.n, 'a denied attempt must be recorded').toBeGreaterThan(before[0]!.n);

      const [entry] = await db.select().from(auditLogs)
        .where(and(
          eq(auditLogs.action, 'PATIENT_ACCESS_DENIED'),
          eq(auditLogs.userId, hr.id),
        )).limit(1);
      expect(entry!.outcome).toBe('DENIED');
      expect(entry!.patientId).toBe(demoPatientId);
      expect(entry!.ipAddress).toBe('10.0.0.9');
    });

    it('reports a missing patient as not found, not as forbidden', async () => {
      await expect(
        assertPatientAccess(doctor, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND', status: 404 });
    });

    it('passes silently for an authorised clinician', async () => {
      await expect(assertPatientAccess(doctor, demoPatientId)).resolves.toBeUndefined();
    });
  });

  describe('search cannot be used to enumerate records', () => {
    it('excludes unauthorised patients even on an exact patient-number match', async () => {
      const [target] = await db.select().from(patients).where(eq(patients.id, otherConsultantsPatientId));

      const asSpecialist = await searchPatients(specialist, { q: target!.patientNumber });
      expect(asSpecialist.items.map((p) => p.id)).not.toContain(otherConsultantsPatientId);
      expect(asSpecialist.total).toBe(0);

      // The same query as an administrator does find it, proving the record exists.
      const asAdmin = await searchPatients(admin, { q: target!.patientNumber });
      expect(asAdmin.items.map((p) => p.id)).toContain(otherConsultantsPatientId);
    });

    it('excludes unauthorised patients on an exact name match', async () => {
      const asSpecialist = await searchPatients(specialist, { q: 'Helen Marsh' });
      expect(asSpecialist.items.map((p) => p.id)).not.toContain(otherConsultantsPatientId);
    });

    it('returns nothing at all for a role with no clinical access', async () => {
      const result = await searchPatients(hr, {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('scopes "my patients" to the caller’s own caseload', async () => {
      const mine = await searchPatients(doctor, { mineOnly: true, pageSize: 100 });
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.items.map((p) => p.id)).not.toContain(otherConsultantsPatientId);
    });

    it('paginates without leaking the total of unauthorised records', async () => {
      const page1 = await searchPatients(doctor, { page: 1, pageSize: 5 });
      const page2 = await searchPatients(doctor, { page: 2, pageSize: 5 });
      expect(page1.items).toHaveLength(5);
      expect(page1.total).toBe(page2.total);
      const overlap = page1.items.filter((a) => page2.items.some((b) => b.id === a.id));
      expect(overlap, 'pages must not repeat records').toHaveLength(0);
    });
  });

  describe('reading a record', () => {
    it('refuses to assemble the header for an unauthorised caller', async () => {
      await expect(getPatientHeader(specialist, otherConsultantsPatientId)).rejects.toThrow(AppError);
    });

    it('returns the connected view for an authorised caller', async () => {
      const header = await getPatientHeader(doctor, demoPatientId);
      expect(header.patientNumber).toBe(DEMO_PATIENT);
      expect(header.fullName).toBe('Rahul Mehta');
      expect(header.allergies).toContain('Penicillin');
      expect(header.admission?.wardName).toBe('Intensive Care Unit');
      expect(header.careTeam.length).toBeGreaterThan(0);
      expect(header.latestVitals).not.toBeNull();
      expect(header.activeMedications.length).toBeGreaterThan(0);
    });
  });

  describe('explicit grants', () => {
    it('opens access, and an expired grant closes it again', async () => {
      const orphan = await patientByNumber('PT-2026-00166'); // under Dr. Jenkins in ICU
      expect((await evaluatePatientAccess(specialist, orphan.id)).allowed).toBe(false);

      await grantPatientAccess({
        patientId: orphan.id,
        userId: specialist.id,
        reason: 'EMERGENCY_ACCESS',
        justification: 'Called to the bedside overnight',
        grantedById: admin.id,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      expect((await evaluatePatientAccess(specialist, orphan.id)).reason).toBe('EXPLICIT_GRANT');

      // An already-expired grant confers nothing.
      const other = await patientByNumber('PT-2026-00157');
      await grantPatientAccess({
        patientId: other.id,
        userId: radiology.id,
        reason: 'ADMIN_GRANT',
        expiresAt: new Date(Date.now() - 1000),
      });
      const decision = await evaluatePatientAccess(radiology, other.id);
      expect(decision.reason).not.toBe('EXPLICIT_GRANT');
    });
  });
});
