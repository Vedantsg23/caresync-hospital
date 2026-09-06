import { describe, it, expect } from 'vitest';
import { scoreVitals } from '@/server/services/clinical.service';
import { flagForValue, isCriticalFlag } from '@/server/services/diagnostics.service';
import { detectAllergyConflicts } from '@/server/services/pharmacy.service';

describe('vitals early-warning scoring', () => {
  it('scores a normal observation set as zero', () => {
    const r = scoreVitals({
      patientId: 'x', respiratoryRate: 16, spo2: 98, temperatureC: 36.8,
      bloodPressureSystolic: 122, bloodPressureDiastolic: 78, heartRate: 76,
    });
    expect(r.score).toBe(0);
    expect(r.abnormal).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('flags a deteriorating patient and explains why', () => {
    const r = scoreVitals({
      patientId: 'x', respiratoryRate: 26, spo2: 91, temperatureC: 38.4,
      bloodPressureSystolic: 92, bloodPressureDiastolic: 58, heartRate: 118,
    });
    expect(r.score).toBeGreaterThanOrEqual(6);
    expect(r.abnormal).toBe(true);
    expect(r.reasons.join(' ')).toContain('Respiratory rate');
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('treats a score of 3 as the threshold for escalation', () => {
    const r = scoreVitals({ patientId: 'x', respiratoryRate: 26 });
    expect(r.score).toBe(3);
    expect(r.abnormal).toBe(true);
  });

  it('ignores measurements that were not taken', () => {
    const r = scoreVitals({ patientId: 'x', heartRate: 76 });
    expect(r.score).toBe(0);
    expect(r.abnormal).toBe(false);
  });

  it('scores bradycardia and tachycardia symmetrically at the extremes', () => {
    expect(scoreVitals({ patientId: 'x', heartRate: 38 }).score).toBe(3);
    expect(scoreVitals({ patientId: 'x', heartRate: 140 }).score).toBe(3);
  });
});

describe('laboratory result flagging', () => {
  const potassium = { referenceLow: 3.5, referenceHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5 };

  it('marks a value inside the reference range as normal', () => {
    expect(flagForValue(4.2, potassium)).toBe('NORMAL');
  });

  it('marks values outside the reference range', () => {
    expect(flagForValue(3.2, potassium)).toBe('LOW');
    expect(flagForValue(5.6, potassium)).toBe('HIGH');
  });

  it('escalates values beyond the critical thresholds', () => {
    expect(flagForValue(2.4, potassium)).toBe('CRITICAL_LOW');
    expect(flagForValue(6.9, potassium)).toBe('CRITICAL_HIGH');
    expect(isCriticalFlag(flagForValue(6.9, potassium))).toBe(true);
    expect(isCriticalFlag(flagForValue(5.6, potassium))).toBe(false);
  });

  it('treats the critical threshold itself as critical', () => {
    expect(flagForValue(2.5, potassium)).toBe('CRITICAL_LOW');
    expect(flagForValue(6.5, potassium)).toBe('CRITICAL_HIGH');
  });

  it('does not invent a flag when there is no numeric value or no range', () => {
    expect(flagForValue(null, potassium)).toBe('NORMAL');
    expect(flagForValue(9999, {})).toBe('NORMAL');
  });
});

describe('allergy interlock', () => {
  it('detects an exact allergy match regardless of case', () => {
    expect(detectAllergyConflicts('Penicillin 500 mg', ['penicillin'])).toEqual(['penicillin']);
    expect(detectAllergyConflicts('amoxicillin', ['Amoxicillin'])).toEqual(['Amoxicillin']);
  });

  it('detects a match on a meaningful word of the medicine name', () => {
    expect(detectAllergyConflicts('Co-amoxiclav 625 mg', ['amoxiclav reaction'])).toHaveLength(1);
  });

  it('does not fire on unrelated medicines', () => {
    expect(detectAllergyConflicts('Paracetamol 500 mg', ['Penicillin', 'Latex'])).toEqual([]);
    expect(detectAllergyConflicts('Aspirin 75 mg', ['Sulfa drugs'])).toEqual([]);
  });

  it('is safe with no recorded allergies', () => {
    expect(detectAllergyConflicts('Aspirin', [])).toEqual([]);
    expect(detectAllergyConflicts('Aspirin', ['', '  '])).toEqual([]);
  });

  it('does not match on short filler words', () => {
    expect(detectAllergyConflicts('IV 5% dextrose', ['dust'])).toEqual([]);
  });
});
