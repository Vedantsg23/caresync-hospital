import '@/server/only';
import { db } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';
import type { AuthUser } from '@/server/auth/context';
import type { Role } from '@/types/rbac';

export const AUDIT = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PATIENT_VIEWED: 'PATIENT_VIEWED',
  PATIENT_CREATED: 'PATIENT_CREATED',
  PATIENT_UPDATED: 'PATIENT_UPDATED',
  PATIENT_SEARCHED: 'PATIENT_SEARCHED',
  PATIENT_ACCESS_DENIED: 'PATIENT_ACCESS_DENIED',
  ADMISSION_CREATED: 'ADMISSION_CREATED',
  PATIENT_TRANSFERRED: 'PATIENT_TRANSFERRED',
  PATIENT_DISCHARGED: 'PATIENT_DISCHARGED',
  ENCOUNTER_CREATED: 'ENCOUNTER_CREATED',
  VITALS_CREATED: 'VITALS_CREATED',
  OBSERVATION_CREATED: 'OBSERVATION_CREATED',
  NOTE_CREATED: 'NOTE_CREATED',
  NOTE_UPDATED: 'NOTE_UPDATED',
  REFERRAL_CREATED: 'REFERRAL_CREATED',
  REFERRAL_ACCEPTED: 'REFERRAL_ACCEPTED',
  REFERRAL_DECLINED: 'REFERRAL_DECLINED',
  REFERRAL_INFORMATION_REQUESTED: 'REFERRAL_INFORMATION_REQUESTED',
  REFERRAL_INFORMATION_PROVIDED: 'REFERRAL_INFORMATION_PROVIDED',
  REFERRAL_RESPONDED: 'REFERRAL_RESPONDED',
  REFERRAL_COMPLETED: 'REFERRAL_COMPLETED',
  REFERRAL_CANCELLED: 'REFERRAL_CANCELLED',
  LAB_ORDER_CREATED: 'LAB_ORDER_CREATED',
  LAB_RESULT_CREATED: 'LAB_RESULT_CREATED',
  RADIOLOGY_STUDY_CREATED: 'RADIOLOGY_STUDY_CREATED',
  RADIOLOGY_REPORT_CREATED: 'RADIOLOGY_REPORT_CREATED',
  MEDICATION_CREATED: 'MEDICATION_CREATED',
  MEDICATION_UPDATED: 'MEDICATION_UPDATED',
  MEDICATION_DISPENSED: 'MEDICATION_DISPENSED',
  MEDICATION_ADMINISTERED: 'MEDICATION_ADMINISTERED',
  WARD_CREATED: 'WARD_CREATED',
  BED_CREATED: 'BED_CREATED',
  BED_STATUS_CHANGED: 'BED_STATUS_CHANGED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  DEPARTMENT_CREATED: 'DEPARTMENT_CREATED',
  FILE_UPLOADED: 'FILE_UPLOADED',
  FILE_DOWNLOADED: 'FILE_DOWNLOADED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  AI_SUMMARY_GENERATED: 'AI_SUMMARY_GENERATED',
  /* --- account lifecycle (production authentication) ------------------- */
  REGISTRATION_SUBMITTED: 'REGISTRATION_SUBMITTED',
  REGISTRATION_REJECTED: 'REGISTRATION_REJECTED',
  REGISTRATION_DUPLICATE: 'REGISTRATION_DUPLICATE',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  ACCOUNT_APPROVED: 'ACCOUNT_APPROVED',
  ACCOUNT_REJECTED: 'ACCOUNT_REJECTED',
  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  SESSION_ROTATED: 'SESSION_ROTATED',
  LOGIN_BLOCKED: 'LOGIN_BLOCKED',
  BOOTSTRAP_COMPLETED: 'BOOTSTRAP_COMPLETED',
  BOOTSTRAP_REFUSED: 'BOOTSTRAP_REFUSED',
  ACCESS_GRANTED: 'ACCESS_GRANTED',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export type AuditInput = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  metadata?: Record<string, unknown> | null;
  actor?: Pick<AuthUser, 'id' | 'email' | 'role'> | null;
  /**
   * The acting user's id where the full actor is not to hand — account
   * lifecycle events, for instance, often know the id and nothing else.
   * `actor` wins when both are supplied.
   */
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Append-only. Audit failures never break the clinical action that triggered
 * them — they are logged loudly instead, because an unrecorded chart entry is
 * worse than an unrecorded audit row.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: input.actor?.id ?? input.userId ?? null,
      actorEmail: input.actor?.email ?? null,
      actorRole: (input.actor?.role as Role | undefined) ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      patientId: input.patientId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      outcome: input.outcome ?? 'SUCCESS',
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    console.error('[audit] FAILED TO RECORD', input.action, err);
  }
}
