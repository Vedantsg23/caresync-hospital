import '@/server/only';
import { aliasedTable, and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  referrals, referralResponses, patients, users, departments, staffProfiles,
  encounters, careTeamMembers, admissions, timelineEvents, patientAccessGrants,
  clinicalNotes,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { nextReferralNumber } from './identifier.service';
import { recordTimelineEvent } from './timeline.service';
import { notify } from './notification.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';
import { MAX_PAGE_SIZE, MAX_REFERENCE_ROWS, boundedLimit } from '@/server/core/pagination';

export type ReferralStatus =
  | 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS' | 'REQUESTED_INFORMATION'
  | 'COMPLETED' | 'DECLINED' | 'CANCELLED';

export type ReferralPriority = 'ROUTINE' | 'URGENT' | 'EMERGENCY';

/**
 * The referral state machine. Mirrored by the `referrals_transition_guard`
 * trigger in migration 0001 so an invalid transition is impossible even if a
 * future caller bypasses this service.
 */
export const REFERRAL_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  PENDING: ['ACCEPTED', 'DECLINED', 'CANCELLED', 'REQUESTED_INFORMATION'],
  REQUESTED_INFORMATION: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'REQUESTED_INFORMATION', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'REQUESTED_INFORMATION', 'CANCELLED'],
  COMPLETED: [],
  DECLINED: [],
  CANCELLED: [],
};

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  return REFERRAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ReferralStatus, to: ReferralStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `A referral that is ${from.toLowerCase().replace('_', ' ')} cannot become ${to.toLowerCase().replace('_', ' ')}.`,
    );
  }
}

const referringUser = aliasedTable(users, 'referring_user');
const specialistUser = aliasedTable(users, 'specialist_user');
const fromDept = aliasedTable(departments, 'from_dept');
const toDept = aliasedTable(departments, 'to_dept');
const specialistProfile = aliasedTable(staffProfiles, 'specialist_profile');

const referralSelection = {
  id: referrals.id,
  referralNumber: referrals.referralNumber,
  patientId: referrals.patientId,
  admissionId: referrals.admissionId,
  encounterId: referrals.encounterId,
  reason: referrals.reason,
  clinicalSummary: referrals.clinicalSummary,
  symptoms: referrals.symptoms,
  relevantHistory: referrals.relevantHistory,
  relevantInvestigations: referrals.relevantInvestigations,
  currentMedications: referrals.currentMedications,
  priority: referrals.priority,
  status: referrals.status,
  informationRequest: referrals.informationRequest,
  informationResponse: referrals.informationResponse,
  declineReason: referrals.declineReason,
  createdAt: referrals.createdAt,
  updatedAt: referrals.updatedAt,
  acceptedAt: referrals.acceptedAt,
  respondedAt: referrals.respondedAt,
  completedAt: referrals.completedAt,
  patientNumber: patients.patientNumber,
  patientFirstName: patients.firstName,
  patientLastName: patients.lastName,
  patientDob: patients.dateOfBirth,
  patientGender: patients.gender,
  patientStatus: patients.status,
  patientAllergies: patients.allergies,
  referringDoctorId: referringUser.id,
  referringDoctorName: referringUser.fullName,
  specialistDoctorId: specialistUser.id,
  specialistDoctorName: specialistUser.fullName,
  specialistSpecialization: specialistProfile.specialization,
  fromDepartmentId: fromDept.id,
  fromDepartmentName: fromDept.name,
  toDepartmentId: toDept.id,
  toDepartmentName: toDept.name,
};

function baseReferralQuery() {
  return db
    .select(referralSelection)
    .from(referrals)
    .innerJoin(patients, eq(patients.id, referrals.patientId))
    .innerJoin(referringUser, eq(referringUser.id, referrals.referringDoctorId))
    .innerJoin(specialistUser, eq(specialistUser.id, referrals.specialistDoctorId))
    .leftJoin(specialistProfile, eq(specialistProfile.userId, referrals.specialistDoctorId))
    .innerJoin(fromDept, eq(fromDept.id, referrals.fromDepartmentId))
    .innerJoin(toDept, eq(toDept.id, referrals.toDepartmentId));
}

/** A referral is visible to its two doctors, the patient's care team, and oversight roles. */
function referralVisibility(user: AuthUser): SQL | undefined {
  if (user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN') return undefined;
  return or(
    eq(referrals.referringDoctorId, user.id),
    eq(referrals.specialistDoctorId, user.id),
    sql`EXISTS (SELECT 1 FROM ${careTeamMembers} c WHERE c.patient_id = referrals.patient_id AND c.user_id = ${user.id} AND c.removed_at IS NULL)`,
    sql`EXISTS (SELECT 1 FROM ${admissions} a WHERE a.patient_id = referrals.patient_id AND a.attending_doctor_id = ${user.id})`,
  );
}

export async function listReferrals(
  user: AuthUser,
  params: {
    box?: 'incoming' | 'outgoing' | 'all';
    status?: ReferralStatus[];
    patientId?: string;
    priority?: ReferralPriority;
    limit?: number;
  } = {},
) {
  const conditions: SQL[] = [];
  const visibility = referralVisibility(user);
  if (visibility) conditions.push(visibility);

  if (params.box === 'incoming') conditions.push(eq(referrals.specialistDoctorId, user.id));
  if (params.box === 'outgoing') conditions.push(eq(referrals.referringDoctorId, user.id));
  if (params.status?.length) conditions.push(inArray(referrals.status, params.status));
  if (params.patientId) conditions.push(eq(referrals.patientId, params.patientId));
  if (params.priority) conditions.push(eq(referrals.priority, params.priority));

  return baseReferralQuery()
    .where(conditions.length ? and(...conditions) : undefined)
    // `referral_priority` is declared ROUTINE, URGENT, EMERGENCY, so ordering by
    // the enum descending already puts emergencies first — the CASE expression
    // this replaces computed the same order, but no index can satisfy an
    // ordering by an expression, so the inbox read every matching referral
    // (9,901 rows, ~845 bytes each) to return fifty. Ordering by the column
    // lets referrals_specialist_priority_created_idx return them already
    // sorted.
    .orderBy(desc(referrals.priority), desc(referrals.createdAt))
    .limit(boundedLimit(params.limit, 50));
}

export async function getReferral(user: AuthUser, referralId: string) {
  const conditions: SQL[] = [eq(referrals.id, referralId)];
  const visibility = referralVisibility(user);
  if (visibility) conditions.push(visibility);

  const [row] = await baseReferralQuery().where(and(...conditions)).limit(1);
  if (!row) throw new AppError('REFERRAL_NOT_FOUND', 'Referral could not be found, or you do not have access to it.');

  const responses = await db
    .select({
      id: referralResponses.id,
      assessment: referralResponses.assessment,
      findings: referralResponses.findings,
      recommendations: referralResponses.recommendations,
      treatmentPlan: referralResponses.treatmentPlan,
      followUp: referralResponses.followUp,
      isFinal: referralResponses.isFinal,
      createdAt: referralResponses.createdAt,
      authorId: users.id,
      authorName: users.fullName,
    })
    .from(referralResponses)
    .innerJoin(users, eq(users.id, referralResponses.authorId))
    .where(eq(referralResponses.referralId, referralId))
    .orderBy(desc(referralResponses.createdAt))
    .limit(MAX_PAGE_SIZE);

  return { ...row, responses };
}

export type CreateReferralInput = {
  patientId: string;
  specialistDoctorId: string;
  toDepartmentId?: string;
  reason: string;
  clinicalSummary: string;
  symptoms?: string;
  relevantHistory?: string;
  relevantInvestigations?: string;
  currentMedications?: string;
  priority?: ReferralPriority;
  encounterId?: string;
};

/**
 * Step 1 of the primary workflow.
 * Validates → checks patient access → persists → timelines → notifies, all in
 * one transaction so a referral can never exist without its audit trail.
 */
export async function createReferral(user: AuthUser, input: CreateReferralInput) {
  await assertPatientAccess(user, input.patientId);

  if (input.specialistDoctorId === user.id) {
    throw new AppError('VALIDATION_ERROR', 'You cannot refer a patient to yourself.');
  }

  const [specialist] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.primaryRole,
      isActive: users.isActive,
      departmentId: staffProfiles.departmentId,
      acceptsReferrals: staffProfiles.acceptsReferrals,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(eq(users.id, input.specialistDoctorId))
    .limit(1);

  if (!specialist || !specialist.isActive) {
    throw new AppError('USER_NOT_FOUND', 'The selected specialist could not be found.');
  }
  if (specialist.role !== 'SENIOR_DOCTOR' && specialist.role !== 'JUNIOR_DOCTOR') {
    throw new AppError('VALIDATION_ERROR', 'Referrals can only be sent to a doctor.');
  }

  const toDepartmentId = input.toDepartmentId ?? specialist.departmentId;
  if (!toDepartmentId) {
    throw new AppError('VALIDATION_ERROR', 'The receiving department could not be determined.');
  }
  if (!user.departmentId) {
    throw new AppError('VALIDATION_ERROR', 'Your staff profile has no department; a referral cannot be raised.');
  }

  const [activeAdmission] = await db
    .select({ id: admissions.id })
    .from(admissions)
    .where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED')))
    .limit(1);

  const referralNumber = await nextReferralNumber();

  const [patient] = await db.select().from(patients).where(eq(patients.id, input.patientId)).limit(1);
  const patientName = `${patient!.firstName} ${patient!.lastName}`;

  const referral = await db.transaction(async (tx) => {
    const [row] = await tx.insert(referrals).values({
      referralNumber,
      patientId: input.patientId,
      admissionId: activeAdmission?.id ?? null,
      encounterId: input.encounterId ?? null,
      referringDoctorId: user.id,
      specialistDoctorId: input.specialistDoctorId,
      fromDepartmentId: user.departmentId!,
      toDepartmentId,
      reason: input.reason,
      clinicalSummary: input.clinicalSummary,
      symptoms: input.symptoms ?? null,
      relevantHistory: input.relevantHistory ?? null,
      relevantInvestigations: input.relevantInvestigations ?? null,
      currentMedications: input.currentMedications ?? null,
      priority: input.priority ?? 'ROUTINE',
      status: 'PENDING',
    }).returning();

    await tx.insert(timelineEvents).values({
      patientId: input.patientId,
      admissionId: activeAdmission?.id ?? null,
      eventType: 'REFERRAL_CREATED',
      title: `Referral to ${specialist.fullName}`,
      description: input.reason,
      actorId: user.id,
      departmentId: toDepartmentId,
      referenceType: 'referral',
      referenceId: row!.id,
      severity: input.priority === 'EMERGENCY' ? 'CRITICAL' : input.priority === 'URGENT' ? 'ATTENTION' : 'INFO',
      metadata: { referralNumber, priority: input.priority ?? 'ROUTINE' },
    });

    return row!;
  });

  await notify({
    recipientId: input.specialistDoctorId,
    patientId: input.patientId,
    type: 'REFERRAL_CREATED',
    title: `New ${(input.priority ?? 'ROUTINE').toLowerCase()} referral`,
    message: `${user.fullName} referred ${patientName} (${patient!.patientNumber}) to you — ${input.reason}`,
    referenceType: 'referral',
    referenceId: referral.id,
    link: `/referrals/${referral.id}`,
    severity: input.priority === 'EMERGENCY' ? 'CRITICAL' : input.priority === 'URGENT' ? 'ATTENTION' : 'INFO',
  });

  await recordAudit({
    action: AUDIT.REFERRAL_CREATED,
    entityType: 'referral',
    entityId: referral.id,
    patientId: input.patientId,
    actor: user,
    metadata: { referralNumber, specialistDoctorId: input.specialistDoctorId, priority: referral.priority },
  });

  return referral;
}

async function loadForSpecialistAction(user: AuthUser, referralId: string) {
  const [row] = await db
    .select({
      id: referrals.id,
      referralNumber: referrals.referralNumber,
      status: referrals.status,
      patientId: referrals.patientId,
      admissionId: referrals.admissionId,
      referringDoctorId: referrals.referringDoctorId,
      specialistDoctorId: referrals.specialistDoctorId,
      toDepartmentId: referrals.toDepartmentId,
      priority: referrals.priority,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientNumber: patients.patientNumber,
    })
    .from(referrals)
    .innerJoin(patients, eq(patients.id, referrals.patientId))
    .where(eq(referrals.id, referralId))
    .limit(1);

  if (!row) throw new AppError('REFERRAL_NOT_FOUND', 'Referral could not be found.');
  if (row.specialistDoctorId !== user.id) {
    throw new AppError('FORBIDDEN', 'Only the specialist this referral was addressed to can perform this action.');
  }
  return row;
}

/** Step 2: the specialist accepts. This is what grants them patient access. */
export async function acceptReferral(user: AuthUser, referralId: string) {
  const referral = await loadForSpecialistAction(user, referralId);
  assertTransition(referral.status as ReferralStatus, 'ACCEPTED');

  const patientName = `${referral.patientFirstName} ${referral.patientLastName}`;
  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(referrals)
      .set({ status: 'ACCEPTED', acceptedAt: now, updatedAt: now })
      .where(eq(referrals.id, referralId))
      .returning();

    // Scoped, auditable access — not a blanket permission grant.
    await tx.insert(patientAccessGrants).values({
      patientId: referral.patientId,
      userId: user.id,
      reason: 'REFERRAL',
      justification: `Accepted referral ${referral.referralNumber}`,
      referenceType: 'referral',
      referenceId: referralId,
      grantedById: referral.referringDoctorId,
    });

    // A specialist already on this patient's care team (a second referral, say)
    // must not appear twice on the chart. `care_team_one_active_per_patient_user`
    // makes that impossible; this keeps the accept idempotent rather than failing.
    await tx.insert(careTeamMembers).values({
      patientId: referral.patientId,
      admissionId: referral.admissionId,
      userId: user.id,
      role: 'SPECIALIST',
      assignedById: referral.referringDoctorId,
    }).onConflictDoNothing();

    await tx.insert(encounters).values({
      patientId: referral.patientId,
      admissionId: referral.admissionId,
      encounterType: 'SPECIALIST_CONSULTATION',
      departmentId: referral.toDepartmentId,
      providerId: user.id,
      reason: `Specialist consultation for referral ${referral.referralNumber}`,
      status: 'IN_PROGRESS',
    });

    await tx.insert(timelineEvents).values({
      patientId: referral.patientId,
      admissionId: referral.admissionId,
      eventType: 'REFERRAL_ACCEPTED',
      title: `${user.fullName} accepted the referral`,
      description: `Referral ${referral.referralNumber} accepted by ${user.designation ?? 'specialist'}`,
      actorId: user.id,
      departmentId: referral.toDepartmentId,
      referenceType: 'referral',
      referenceId: referralId,
    });

    return row!;
  });

  await notify({
    recipientId: referral.referringDoctorId,
    patientId: referral.patientId,
    type: 'REFERRAL_ACCEPTED',
    title: 'Referral accepted',
    message: `${user.fullName} accepted your referral for ${patientName}.`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
  });

  await recordAudit({
    action: AUDIT.REFERRAL_ACCEPTED,
    entityType: 'referral',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
    metadata: { referralNumber: referral.referralNumber },
  });
  await recordAudit({
    action: AUDIT.ACCESS_GRANTED,
    entityType: 'patient_access_grant',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
    metadata: { reason: 'REFERRAL', referralNumber: referral.referralNumber },
  });

  return updated;
}

export async function declineReferral(user: AuthUser, referralId: string, reason: string) {
  const referral = await loadForSpecialistAction(user, referralId);
  assertTransition(referral.status as ReferralStatus, 'DECLINED');

  const [updated] = await db.update(referrals)
    .set({ status: 'DECLINED', declineReason: reason, updatedAt: new Date() })
    .where(eq(referrals.id, referralId))
    .returning();

  await recordTimelineEvent({
    patientId: referral.patientId,
    admissionId: referral.admissionId,
    eventType: 'REFERRAL_DECLINED',
    title: `${user.fullName} declined the referral`,
    description: reason,
    actorId: user.id,
    departmentId: referral.toDepartmentId,
    referenceType: 'referral',
    referenceId: referralId,
    severity: 'ATTENTION',
  });

  await notify({
    recipientId: referral.referringDoctorId,
    patientId: referral.patientId,
    type: 'REFERRAL_DECLINED',
    title: 'Referral declined',
    message: `${user.fullName} declined your referral for ${referral.patientFirstName} ${referral.patientLastName}: ${reason}`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
    severity: 'ATTENTION',
  });

  await recordAudit({
    action: AUDIT.REFERRAL_DECLINED,
    entityType: 'referral',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
    metadata: { reason },
  });

  return updated!;
}

export async function requestInformation(user: AuthUser, referralId: string, question: string) {
  const referral = await loadForSpecialistAction(user, referralId);
  assertTransition(referral.status as ReferralStatus, 'REQUESTED_INFORMATION');

  const [updated] = await db.update(referrals)
    .set({ status: 'REQUESTED_INFORMATION', informationRequest: question, updatedAt: new Date() })
    .where(eq(referrals.id, referralId))
    .returning();

  await recordTimelineEvent({
    patientId: referral.patientId,
    admissionId: referral.admissionId,
    eventType: 'REFERRAL_INFORMATION_REQUESTED',
    title: `${user.fullName} requested more information`,
    description: question,
    actorId: user.id,
    departmentId: referral.toDepartmentId,
    referenceType: 'referral',
    referenceId: referralId,
    severity: 'ATTENTION',
  });

  await notify({
    recipientId: referral.referringDoctorId,
    patientId: referral.patientId,
    type: 'REFERRAL_INFORMATION_REQUESTED',
    title: 'More information requested',
    message: `${user.fullName} needs more information for ${referral.patientFirstName} ${referral.patientLastName}: ${question}`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
    severity: 'ATTENTION',
  });

  await recordAudit({
    action: AUDIT.REFERRAL_INFORMATION_REQUESTED,
    entityType: 'referral',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
  });

  return updated!;
}

/** The referring doctor answers the specialist's question; the referral re-queues. */
export async function provideInformation(user: AuthUser, referralId: string, answer: string) {
  const [referral] = await db.select().from(referrals).where(eq(referrals.id, referralId)).limit(1);
  if (!referral) throw new AppError('REFERRAL_NOT_FOUND', 'Referral could not be found.');
  if (referral.referringDoctorId !== user.id) {
    throw new AppError('FORBIDDEN', 'Only the referring doctor can supply the requested information.');
  }
  assertTransition(referral.status as ReferralStatus, 'PENDING');

  const [updated] = await db.update(referrals)
    .set({ status: 'PENDING', informationResponse: answer, updatedAt: new Date() })
    .where(eq(referrals.id, referralId))
    .returning();

  await recordTimelineEvent({
    patientId: referral.patientId,
    admissionId: referral.admissionId,
    eventType: 'REFERRAL_INFORMATION_REQUESTED',
    title: `${user.fullName} supplied the requested information`,
    description: answer,
    actorId: user.id,
    referenceType: 'referral',
    referenceId: referralId,
  });

  await notify({
    recipientId: referral.specialistDoctorId,
    patientId: referral.patientId,
    type: 'REFERRAL_CREATED',
    title: 'Referral information supplied',
    message: `${user.fullName} answered your question on referral ${referral.referralNumber}.`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
  });

  await recordAudit({
    action: AUDIT.REFERRAL_INFORMATION_PROVIDED,
    entityType: 'referral',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
  });

  return updated!;
}

export type RespondInput = {
  assessment: string;
  findings: string;
  recommendations: string;
  treatmentPlan: string;
  followUp?: string;
};

/** Step 3: the specialist records their consultation. */
export async function respondToReferral(user: AuthUser, referralId: string, input: RespondInput) {
  const referral = await loadForSpecialistAction(user, referralId);

  if (!['ACCEPTED', 'IN_PROGRESS'].includes(referral.status)) {
    throw new AppError('INVALID_STATE_TRANSITION', 'Accept the referral before recording a specialist response.');
  }

  const now = new Date();
  const patientName = `${referral.patientFirstName} ${referral.patientLastName}`;

  const response = await db.transaction(async (tx) => {
    const [res] = await tx.insert(referralResponses).values({
      referralId,
      assessment: input.assessment,
      findings: input.findings,
      recommendations: input.recommendations,
      treatmentPlan: input.treatmentPlan,
      followUp: input.followUp ?? null,
      authorId: user.id,
      isFinal: false,
    }).returning();

    if (referral.status === 'ACCEPTED') {
      await tx.update(referrals)
        .set({ status: 'IN_PROGRESS', respondedAt: now, updatedAt: now })
        .where(eq(referrals.id, referralId));
    } else {
      await tx.update(referrals).set({ respondedAt: now, updatedAt: now }).where(eq(referrals.id, referralId));
    }

    // The specialist's assessment also becomes a specialist note on the chart,
    // so it is visible to anyone reading the record — not only inside the referral.
    await tx.insert(clinicalNotes).values({
      patientId: referral.patientId,
      admissionId: referral.admissionId,
      noteType: 'SPECIALIST',
      title: `Specialist consultation — referral ${referral.referralNumber}`,
      content:
        `ASSESSMENT\n${input.assessment}\n\nFINDINGS\n${input.findings}\n\n` +
        `RECOMMENDATIONS\n${input.recommendations}\n\nTREATMENT PLAN\n${input.treatmentPlan}` +
        (input.followUp ? `\n\nFOLLOW-UP\n${input.followUp}` : ''),
      authorId: user.id,
      authorRole: user.role,
      departmentId: referral.toDepartmentId,
    });

    await tx.insert(timelineEvents).values({
      patientId: referral.patientId,
      admissionId: referral.admissionId,
      eventType: 'REFERRAL_RESPONSE',
      title: `Specialist response from ${user.fullName}`,
      description: input.assessment,
      actorId: user.id,
      departmentId: referral.toDepartmentId,
      referenceType: 'referral',
      referenceId: referralId,
    });

    return res!;
  });

  await notify({
    recipientId: referral.referringDoctorId,
    patientId: referral.patientId,
    type: 'REFERRAL_RESPONSE',
    title: 'Specialist response available',
    message: `${user.fullName} recorded a specialist response for ${patientName}.`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
  });

  await recordAudit({
    action: AUDIT.REFERRAL_RESPONDED,
    entityType: 'referral_response',
    entityId: response.id,
    patientId: referral.patientId,
    actor: user,
    metadata: { referralId, referralNumber: referral.referralNumber },
  });

  return response;
}

/** Step 4: the specialist closes the loop. */
export async function completeReferral(user: AuthUser, referralId: string) {
  const referral = await loadForSpecialistAction(user, referralId);
  assertTransition(referral.status as ReferralStatus, 'COMPLETED');

  const responses = await db.select({ id: referralResponses.id })
    .from(referralResponses).where(eq(referralResponses.referralId, referralId)).limit(1);
  if (responses.length === 0) {
    throw new AppError('INVALID_STATE_TRANSITION', 'Record a specialist response before completing the referral.');
  }

  const now = new Date();
  const patientName = `${referral.patientFirstName} ${referral.patientLastName}`;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(referrals)
      .set({ status: 'COMPLETED', completedAt: now, updatedAt: now })
      .where(eq(referrals.id, referralId))
      .returning();

    await tx.update(referralResponses)
      .set({ isFinal: true, updatedAt: now })
      .where(eq(referralResponses.referralId, referralId));

    await tx.update(encounters)
      .set({ status: 'COMPLETED', endTime: now, updatedAt: now })
      .where(and(
        eq(encounters.patientId, referral.patientId),
        eq(encounters.providerId, user.id),
        eq(encounters.encounterType, 'SPECIALIST_CONSULTATION'),
        eq(encounters.status, 'IN_PROGRESS'),
      ));

    await tx.insert(timelineEvents).values({
      patientId: referral.patientId,
      admissionId: referral.admissionId,
      eventType: 'REFERRAL_COMPLETED',
      title: `Referral ${referral.referralNumber} completed`,
      description: `Specialist review closed by ${user.fullName}`,
      actorId: user.id,
      departmentId: referral.toDepartmentId,
      referenceType: 'referral',
      referenceId: referralId,
    });

    return row!;
  });

  await notify({
    recipientId: referral.referringDoctorId,
    patientId: referral.patientId,
    type: 'REFERRAL_COMPLETED',
    title: 'Referral completed',
    message: `${user.fullName} completed the specialist review for ${patientName}. The response is on the patient record.`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
  });

  await recordAudit({
    action: AUDIT.REFERRAL_COMPLETED,
    entityType: 'referral',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
    metadata: { referralNumber: referral.referralNumber },
  });

  return updated;
}

export async function cancelReferral(user: AuthUser, referralId: string, reason?: string) {
  const [referral] = await db.select().from(referrals).where(eq(referrals.id, referralId)).limit(1);
  if (!referral) throw new AppError('REFERRAL_NOT_FOUND', 'Referral could not be found.');

  const isOwner = referral.referringDoctorId === user.id;
  const isOversight = user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN';
  if (!isOwner && !isOversight) {
    throw new AppError('FORBIDDEN', 'Only the referring doctor or an administrator can cancel a referral.');
  }
  assertTransition(referral.status as ReferralStatus, 'CANCELLED');

  const [updated] = await db.update(referrals)
    .set({ status: 'CANCELLED', declineReason: reason ?? null, updatedAt: new Date() })
    .where(eq(referrals.id, referralId))
    .returning();

  await notify({
    recipientId: referral.specialistDoctorId,
    patientId: referral.patientId,
    type: 'SYSTEM',
    title: 'Referral cancelled',
    message: `${user.fullName} cancelled referral ${referral.referralNumber}.`,
    referenceType: 'referral',
    referenceId: referralId,
    link: `/referrals/${referralId}`,
  });

  await recordAudit({
    action: AUDIT.REFERRAL_CANCELLED,
    entityType: 'referral',
    entityId: referralId,
    patientId: referral.patientId,
    actor: user,
    metadata: { reason },
  });

  return updated!;
}

/** Doctors who can receive referrals, for the "Refer to specialist" picker. */
export async function listSpecialists(excludeUserId?: string) {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.primaryRole,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      departmentId: departments.id,
      departmentName: departments.name,
      acceptsReferrals: staffProfiles.acceptsReferrals,
    })
    .from(users)
    .innerJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(and(
      eq(users.isActive, true),
      inArray(users.primaryRole, ['SENIOR_DOCTOR', 'JUNIOR_DOCTOR']),
    ))
    .orderBy(departments.name, users.fullName)
    .limit(MAX_REFERENCE_ROWS);

  return excludeUserId ? rows.filter((r) => r.id !== excludeUserId) : rows;
}
