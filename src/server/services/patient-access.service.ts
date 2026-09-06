import '@/server/only';
import { and, eq, isNull, or, gt, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  patients, admissions, careTeamMembers, encounters, referrals,
  patientAccessGrants, investigationOrders, radiologyStudies,
  medicationOrders, staffProfiles,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';

export type AccessDecision = {
  allowed: boolean;
  reason:
    | 'OVERSIGHT_ROLE' | 'ATTENDING_DOCTOR' | 'CARE_TEAM' | 'ENCOUNTER_PROVIDER'
    | 'REFERRAL_PARTY' | 'EXPLICIT_GRANT' | 'DIAGNOSTIC_ORDER' | 'WARD_NURSE'
    | 'DENIED';
};

/**
 * The single authority on "may this user see this patient?".
 *
 * Mirrors `caresync_can_access_patient()` in migration 0002 clause for clause,
 * so the same answer is produced whether the query goes through the service
 * layer or straight at the database under RLS.
 *
 * Knowing a patient ID is never sufficient — every branch requires a real
 * clinical relationship, an explicit grant, or an oversight role.
 */
export async function evaluatePatientAccess(user: AuthUser, patientId: string): Promise<AccessDecision> {
  if (user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN') {
    return { allowed: true, reason: 'OVERSIGHT_ROLE' };
  }

  const [attending] = await db.select({ n: sql<number>`1` }).from(admissions)
    .where(and(eq(admissions.patientId, patientId), eq(admissions.attendingDoctorId, user.id))).limit(1);
  if (attending) return { allowed: true, reason: 'ATTENDING_DOCTOR' };

  const [team] = await db.select({ n: sql<number>`1` }).from(careTeamMembers)
    .where(and(
      eq(careTeamMembers.patientId, patientId),
      eq(careTeamMembers.userId, user.id),
      isNull(careTeamMembers.removedAt),
    )).limit(1);
  if (team) return { allowed: true, reason: 'CARE_TEAM' };

  const [enc] = await db.select({ n: sql<number>`1` }).from(encounters)
    .where(and(eq(encounters.patientId, patientId), eq(encounters.providerId, user.id))).limit(1);
  if (enc) return { allowed: true, reason: 'ENCOUNTER_PROVIDER' };

  const [ref] = await db.select({ n: sql<number>`1` }).from(referrals)
    .where(and(
      eq(referrals.patientId, patientId),
      or(eq(referrals.referringDoctorId, user.id), eq(referrals.specialistDoctorId, user.id)),
    )).limit(1);
  if (ref) return { allowed: true, reason: 'REFERRAL_PARTY' };

  const [grant] = await db.select({ n: sql<number>`1` }).from(patientAccessGrants)
    .where(and(
      eq(patientAccessGrants.patientId, patientId),
      eq(patientAccessGrants.userId, user.id),
      isNull(patientAccessGrants.revokedAt),
      or(isNull(patientAccessGrants.expiresAt), gt(patientAccessGrants.expiresAt, new Date())),
    )).limit(1);
  if (grant) return { allowed: true, reason: 'EXPLICIT_GRANT' };

  if (user.role === 'PATHOLOGY') {
    const [o] = await db.select({ n: sql<number>`1` }).from(investigationOrders)
      .where(and(eq(investigationOrders.patientId, patientId), eq(investigationOrders.category, 'LAB'))).limit(1);
    if (o) return { allowed: true, reason: 'DIAGNOSTIC_ORDER' };
  }

  if (user.role === 'RADIOLOGY') {
    const [s] = await db.select({ n: sql<number>`1` }).from(radiologyStudies)
      .where(eq(radiologyStudies.patientId, patientId)).limit(1);
    if (s) return { allowed: true, reason: 'DIAGNOSTIC_ORDER' };
  }

  if (user.role === 'PHARMACY') {
    const [m] = await db.select({ n: sql<number>`1` }).from(medicationOrders)
      .where(eq(medicationOrders.patientId, patientId)).limit(1);
    if (m) return { allowed: true, reason: 'DIAGNOSTIC_ORDER' };
  }

  if (user.role === 'NURSE' && user.departmentId) {
    const [w] = await db.select({ n: sql<number>`1` }).from(admissions)
      .where(and(
        eq(admissions.patientId, patientId),
        eq(admissions.status, 'ADMITTED'),
        eq(admissions.departmentId, user.departmentId),
      )).limit(1);
    if (w) return { allowed: true, reason: 'WARD_NURSE' };
  }

  return { allowed: false, reason: 'DENIED' };
}

/** Throws 403/404. Denials are audited — an attempted breach is an event. */
export async function assertPatientAccess(
  user: AuthUser,
  patientId: string,
  context?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const [exists] = await db.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!exists) throw new AppError('PATIENT_NOT_FOUND', 'Patient could not be found.');

  const decision = await evaluatePatientAccess(user, patientId);
  if (!decision.allowed) {
    await recordAudit({
      action: AUDIT.PATIENT_ACCESS_DENIED,
      entityType: 'patient',
      entityId: patientId,
      patientId,
      outcome: 'DENIED',
      actor: user,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { role: user.role },
    });
    throw new AppError(
      'PATIENT_ACCESS_DENIED',
      'You are not part of this patient’s care and do not have access to their record.',
    );
  }
}

/**
 * Returns the SQL predicate restricting a patient query to what this user may
 * see. Used by list/search so unauthorised records never enter a result set —
 * filtering in the UI would be theatre.
 */
export function patientVisibilityFilter(user: AuthUser) {
  if (user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN') return undefined;

  const uid = user.id;
  const clauses = [
    sql`EXISTS (SELECT 1 FROM ${admissions} a WHERE a.patient_id = patients.id AND a.attending_doctor_id = ${uid})`,
    sql`EXISTS (SELECT 1 FROM ${careTeamMembers} c WHERE c.patient_id = patients.id AND c.user_id = ${uid} AND c.removed_at IS NULL)`,
    sql`EXISTS (SELECT 1 FROM ${encounters} e WHERE e.patient_id = patients.id AND e.provider_id = ${uid})`,
    sql`EXISTS (SELECT 1 FROM ${referrals} r WHERE r.patient_id = patients.id AND (r.referring_doctor_id = ${uid} OR r.specialist_doctor_id = ${uid}))`,
    sql`EXISTS (SELECT 1 FROM ${patientAccessGrants} g WHERE g.patient_id = patients.id AND g.user_id = ${uid} AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()))`,
  ];

  if (user.role === 'PATHOLOGY') {
    clauses.push(sql`EXISTS (SELECT 1 FROM ${investigationOrders} o WHERE o.patient_id = patients.id AND o.category = 'LAB')`);
  }
  if (user.role === 'RADIOLOGY') {
    clauses.push(sql`EXISTS (SELECT 1 FROM ${radiologyStudies} s WHERE s.patient_id = patients.id)`);
  }
  if (user.role === 'PHARMACY') {
    clauses.push(sql`EXISTS (SELECT 1 FROM ${medicationOrders} m WHERE m.patient_id = patients.id)`);
  }
  if (user.role === 'NURSE') {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM ${admissions} a
      JOIN ${staffProfiles} sp ON sp.user_id = ${uid}
      WHERE a.patient_id = ${patients.id} AND a.status = 'ADMITTED' AND a.department_id = sp.department_id)`);
  }

  return sql.join(clauses, sql` OR `);
}

/** Grants scoped access — e.g. when a specialist accepts a referral. */
export async function grantPatientAccess(params: {
  patientId: string;
  userId: string;
  reason: 'REFERRAL' | 'CARE_TEAM' | 'DEPARTMENT_ORDER' | 'ADMIN_GRANT' | 'EMERGENCY_ACCESS';
  justification?: string;
  referenceType?: string;
  referenceId?: string;
  grantedById?: string;
  expiresAt?: Date | null;
}): Promise<void> {
  await db.insert(patientAccessGrants).values({
    patientId: params.patientId,
    userId: params.userId,
    reason: params.reason,
    justification: params.justification ?? null,
    referenceType: params.referenceType ?? null,
    referenceId: params.referenceId ?? null,
    grantedById: params.grantedById ?? null,
    expiresAt: params.expiresAt ?? null,
  });
}
