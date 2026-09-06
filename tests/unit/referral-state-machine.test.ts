import { describe, it, expect } from 'vitest';
import {
  REFERRAL_TRANSITIONS, canTransition, assertTransition, type ReferralStatus,
} from '@/server/services/referral.service';
import { AppError } from '@/server/core/errors';

const ALL: ReferralStatus[] = [
  'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'REQUESTED_INFORMATION',
  'COMPLETED', 'DECLINED', 'CANCELLED',
];

describe('referral state machine', () => {
  it('covers every status', () => {
    for (const s of ALL) expect(REFERRAL_TRANSITIONS[s]).toBeDefined();
  });

  it('allows the happy path a doctor and specialist actually walk', () => {
    expect(canTransition('PENDING', 'ACCEPTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransition('ACCEPTED', 'COMPLETED')).toBe(true);
  });

  it('supports the information round trip', () => {
    expect(canTransition('PENDING', 'REQUESTED_INFORMATION')).toBe(true);
    expect(canTransition('REQUESTED_INFORMATION', 'PENDING')).toBe(true);
    expect(canTransition('REQUESTED_INFORMATION', 'ACCEPTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'REQUESTED_INFORMATION')).toBe(true);
  });

  it('treats COMPLETED, DECLINED and CANCELLED as terminal', () => {
    for (const terminal of ['COMPLETED', 'DECLINED', 'CANCELLED'] as ReferralStatus[]) {
      expect(REFERRAL_TRANSITIONS[terminal]).toEqual([]);
      for (const target of ALL) {
        expect(canTransition(terminal, target), `${terminal} -> ${target}`).toBe(false);
      }
    }
  });

  it('never lets a referral be completed before it is accepted', () => {
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('REQUESTED_INFORMATION', 'COMPLETED')).toBe(false);
  });

  it('never lets a referral be reopened once declined', () => {
    expect(canTransition('DECLINED', 'PENDING')).toBe(false);
    expect(canTransition('DECLINED', 'ACCEPTED')).toBe(false);
  });

  it('throws a typed, readable error on an invalid transition', () => {
    expect(() => assertTransition('COMPLETED', 'ACCEPTED')).toThrow(AppError);
    try {
      assertTransition('COMPLETED', 'ACCEPTED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).message).toContain('completed');
    }
  });

  it('accepts a valid transition without throwing', () => {
    expect(() => assertTransition('PENDING', 'ACCEPTED')).not.toThrow();
  });

  it('lists no transition that targets a status outside the machine', () => {
    for (const from of ALL) {
      for (const to of REFERRAL_TRANSITIONS[from]) {
        expect(ALL, `${from} -> ${to}`).toContain(to);
      }
    }
  });
});
