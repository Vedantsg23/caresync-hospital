import { describe, it, expect } from 'vitest';
import {
  loginSchema, createPatientSchema, vitalsSchema, createReferralSchema,
  referralResponseSchema, prescribeSchema, createStaffSchema, createNoteSchema,
} from '@/server/validators';
import { passwordIssues } from '@/server/auth/password';

const uuid = '3f8b2c1e-5d4a-4b7c-9e1f-2a3b4c5d6e7f';

describe('request validation', () => {
  it('normalises the email on login and requires a password', () => {
    const ok = loginSchema.safeParse({ email: '  Doctor@CareSync.Demo ', password: 'x' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBe('doctor@caresync.demo');

    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('rejects an impossible date of birth', () => {
    const base = { firstName: 'A', lastName: 'B', gender: 'MALE' as const };
    const future = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    expect(createPatientSchema.safeParse({ ...base, dateOfBirth: future }).success).toBe(false);
    expect(createPatientSchema.safeParse({ ...base, dateOfBirth: '1850-01-01' }).success).toBe(false);
    expect(createPatientSchema.safeParse({ ...base, dateOfBirth: '1980-05-14' }).success).toBe(true);
  });

  it('requires at least one measurement in an observation set', () => {
    expect(vitalsSchema.safeParse({}).success).toBe(false);
    expect(vitalsSchema.safeParse({ notes: 'nothing measured' }).success).toBe(false);
    expect(vitalsSchema.safeParse({ heartRate: 76 }).success).toBe(true);
  });

  it('rejects physiologically impossible observations', () => {
    expect(vitalsSchema.safeParse({ heartRate: 900 }).success).toBe(false);
    expect(vitalsSchema.safeParse({ spo2: 140 }).success).toBe(false);
    expect(vitalsSchema.safeParse({ temperatureC: 12 }).success).toBe(false);
  });

  it('rejects a blood pressure where diastolic exceeds systolic', () => {
    const bad = vitalsSchema.safeParse({ bloodPressureSystolic: 80, bloodPressureDiastolic: 120 });
    expect(bad.success).toBe(false);
    expect(vitalsSchema.safeParse({ bloodPressureSystolic: 120, bloodPressureDiastolic: 80 }).success).toBe(true);
  });

  it('requires the clinical substance of a referral', () => {
    const complete = {
      patientId: uuid, specialistDoctorId: uuid,
      reason: 'Persistent chest pain', clinicalSummary: 'Detailed summary of the presentation.',
    };
    expect(createReferralSchema.safeParse(complete).success).toBe(true);
    expect(createReferralSchema.safeParse({ ...complete, reason: '' }).success).toBe(false);
    expect(createReferralSchema.safeParse({ ...complete, clinicalSummary: '   ' }).success).toBe(false);
    expect(createReferralSchema.safeParse({ ...complete, patientId: 'not-a-uuid' }).success).toBe(false);
    expect(createReferralSchema.safeParse({ ...complete, priority: 'WHENEVER' }).success).toBe(false);
  });

  it('requires all four clinical sections of a specialist response', () => {
    const full = {
      assessment: 'a', findings: 'b', recommendations: 'c', treatmentPlan: 'd',
    };
    expect(referralResponseSchema.safeParse(full).success).toBe(true);
    for (const key of Object.keys(full)) {
      expect(referralResponseSchema.safeParse({ ...full, [key]: '' }).success, `${key} must be required`).toBe(false);
    }
  });

  it('rejects a prescription that ends before it starts', () => {
    const base = {
      patientId: uuid, medicineName: 'Aspirin', dose: '75 mg',
      frequency: 'Once daily', route: 'ORAL' as const,
    };
    expect(prescribeSchema.safeParse({ ...base, startDate: '2026-01-10', endDate: '2026-01-01' }).success).toBe(false);
    expect(prescribeSchema.safeParse({ ...base, startDate: '2026-01-01', endDate: '2026-01-10' }).success).toBe(true);
    expect(prescribeSchema.safeParse({ ...base, startDate: '2026-01-01' }).success).toBe(true);
  });

  it('rejects an unknown role when creating staff', () => {
    const base = {
      email: 'new@caresync.demo', fullName: 'New Person',
      password: 'Str0ngPassword', designation: 'Registrar',
    };
    expect(createStaffSchema.safeParse({ ...base, role: 'SENIOR_DOCTOR' }).success).toBe(true);
    expect(createStaffSchema.safeParse({ ...base, role: 'CHIEF_WIZARD' }).success).toBe(false);
    expect(createStaffSchema.safeParse({ ...base, role: 'NURSE', password: 'short' }).success).toBe(false);
  });

  it('requires a real note type and non-empty content', () => {
    expect(createNoteSchema.safeParse({ noteType: 'PROGRESS', title: 'Round', content: 'Seen.' }).success).toBe(true);
    expect(createNoteSchema.safeParse({ noteType: 'GOSSIP', title: 'x', content: 'y' }).success).toBe(false);
    expect(createNoteSchema.safeParse({ noteType: 'PROGRESS', title: 'x', content: '  ' }).success).toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a password meeting every rule', () => {
    expect(passwordIssues('CareSync#2026')).toEqual([]);
  });

  it('reports each failing rule separately', () => {
    expect(passwordIssues('short1A')).toContain('must be at least 10 characters');
    expect(passwordIssues('alllowercase1')).toContain('must contain an uppercase letter');
    expect(passwordIssues('ALLUPPERCASE1')).toContain('must contain a lowercase letter');
    expect(passwordIssues('NoDigitsHere')).toContain('must contain a number');
  });

  it('reports every problem at once so the user fixes them together', () => {
    expect(passwordIssues('abc').length).toBeGreaterThanOrEqual(3);
  });
});
