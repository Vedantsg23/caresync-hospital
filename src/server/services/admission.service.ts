import '@/server/only';
import { and, asc, desc, eq, sql, inArray } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  admissions, admissionTransfers, beds, wards, departments, patients, users,
  careTeamMembers, encounters,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { nextAdmissionNumber } from './identifier.service';
import { recordTimelineEvent } from './timeline.service';
import { notify } from './notification.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';
import { MAX_PAGE_SIZE, MAX_REFERENCE_ROWS, boundedLimit } from '@/server/core/pagination';

export async function listWards(departmentId?: string) {
  return db
    .select({
      id: wards.id,
      code: wards.code,
      name: wards.name,
      floor: wards.floor,
      isCritical: wards.isCritical,
      departmentId: departments.id,
      departmentName: departments.name,
      totalBeds: sql<number>`(SELECT count(*)::int FROM ${beds} b WHERE b.ward_id = wards.id)`,
      occupiedBeds: sql<number>`(SELECT count(*)::int FROM ${beds} b WHERE b.ward_id = wards.id AND b.status = 'OCCUPIED')`,
      availableBeds: sql<number>`(SELECT count(*)::int FROM ${beds} b WHERE b.ward_id = wards.id AND b.status = 'AVAILABLE')`,
    })
    .from(wards)
    .innerJoin(departments, eq(departments.id, wards.departmentId))
    .where(departmentId ? and(eq(wards.isActive, true), eq(wards.departmentId, departmentId)) : eq(wards.isActive, true))
    .orderBy(asc(departments.name), asc(wards.name));
}

export async function listBeds(wardId?: string) {
  return db
    .select({
      id: beds.id,
      code: beds.code,
      status: beds.status,
      notes: beds.notes,
      wardId: wards.id,
      wardName: wards.name,
      departmentName: departments.name,
      patientId: patients.id,
      patientName: sql<string | null>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
      admissionId: admissions.id,
    })
    .from(beds)
    .innerJoin(wards, eq(wards.id, beds.wardId))
    .innerJoin(departments, eq(departments.id, wards.departmentId))
    .leftJoin(admissions, and(eq(admissions.bedId, beds.id), eq(admissions.status, 'ADMITTED')))
    .leftJoin(patients, eq(patients.id, admissions.patientId))
    .where(wardId ? eq(beds.wardId, wardId) : undefined)
    .orderBy(asc(wards.name), asc(beds.code))
    .limit(MAX_REFERENCE_ROWS);
}

export type CreateAdmissionInput = {
  patientId: string;
  departmentId: string;
  wardId?: string;
  bedId?: string;
  attendingDoctorId: string;
  reason: string;
};

export async function createAdmission(user: AuthUser, input: CreateAdmissionInput) {
  await assertPatientAccess(user, input.patientId);

  const [open] = await db.select({ id: admissions.id }).from(admissions)
    .where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED'))).limit(1);
  if (open) throw new AppError('CONFLICT', 'This patient already has an open admission.');

  if (input.bedId) {
    const [bed] = await db.select().from(beds).where(eq(beds.id, input.bedId)).limit(1);
    if (!bed) throw new AppError('NOT_FOUND', 'The selected bed could not be found.');
    if (bed.status !== 'AVAILABLE') {
      throw new AppError('BED_UNAVAILABLE', `Bed ${bed.code} is ${bed.status.toLowerCase()} and cannot be assigned.`);
    }
  }

  const admissionNumber = await nextAdmissionNumber();
  const [patient] = await db.select().from(patients).where(eq(patients.id, input.patientId)).limit(1);

  const admission = await db.transaction(async (tx) => {
    const [row] = await tx.insert(admissions).values({
      patientId: input.patientId,
      admissionNumber,
      departmentId: input.departmentId,
      wardId: input.wardId ?? null,
      bedId: input.bedId ?? null,
      attendingDoctorId: input.attendingDoctorId,
      reason: input.reason,
      status: 'ADMITTED',
      createdById: user.id,
    }).returning();

    if (input.bedId) {
      await tx.update(beds).set({ status: 'OCCUPIED', updatedAt: new Date() }).where(eq(beds.id, input.bedId));
    }

    await tx.insert(careTeamMembers).values({
      patientId: input.patientId,
      admissionId: row!.id,
      userId: input.attendingDoctorId,
      role: 'ATTENDING',
      assignedById: user.id,
    }).onConflictDoNothing();

    await tx.insert(encounters).values({
      patientId: input.patientId,
      admissionId: row!.id,
      encounterType: 'INPATIENT',
      departmentId: input.departmentId,
      providerId: input.attendingDoctorId,
      reason: input.reason,
      status: 'IN_PROGRESS',
    });

    return row!;
  });

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission.id,
    eventType: 'ADMISSION_CREATED',
    title: `Admitted — ${admissionNumber}`,
    description: input.reason,
    actorId: user.id,
    departmentId: input.departmentId,
    referenceType: 'admission',
    referenceId: admission.id,
  });

  if (input.attendingDoctorId !== user.id) {
    await notify({
      recipientId: input.attendingDoctorId,
      patientId: input.patientId,
      type: 'PATIENT_ADMITTED',
      title: 'New patient admitted under your care',
      message: `${patient!.firstName} ${patient!.lastName} (${patient!.patientNumber}) — ${input.reason}`,
      referenceType: 'admission',
      referenceId: admission.id,
      link: `/patients/${input.patientId}`,
    });
  }

  await recordAudit({
    action: AUDIT.ADMISSION_CREATED,
    entityType: 'admission',
    entityId: admission.id,
    patientId: input.patientId,
    actor: user,
    metadata: { admissionNumber },
  });

  return admission;
}

export async function transferPatient(
  user: AuthUser,
  admissionId: string,
  input: { toWardId: string; toBedId?: string; reason?: string },
) {
  const [admission] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
  if (!admission) throw new AppError('NOT_FOUND', 'Admission could not be found.');
  if (admission.status !== 'ADMITTED') throw new AppError('CONFLICT', 'Only an open admission can be transferred.');

  await assertPatientAccess(user, admission.patientId);

  if (input.toBedId) {
    const [bed] = await db.select().from(beds).where(eq(beds.id, input.toBedId)).limit(1);
    if (!bed) throw new AppError('NOT_FOUND', 'The destination bed could not be found.');
    if (bed.status !== 'AVAILABLE' && bed.id !== admission.bedId) {
      throw new AppError('BED_UNAVAILABLE', `Bed ${bed.code} is ${bed.status.toLowerCase()} and cannot be assigned.`);
    }
  }

  const [toWard] = await db.select().from(wards).where(eq(wards.id, input.toWardId)).limit(1);
  if (!toWard) throw new AppError('NOT_FOUND', 'The destination ward could not be found.');

  const updated = await db.transaction(async (tx) => {
    await tx.insert(admissionTransfers).values({
      admissionId,
      fromWardId: admission.wardId,
      fromBedId: admission.bedId,
      toWardId: input.toWardId,
      toBedId: input.toBedId ?? null,
      reason: input.reason ?? null,
      performedById: user.id,
    });

    // Old bed is released, new bed is taken — history is preserved above.
    if (admission.bedId && admission.bedId !== input.toBedId) {
      await tx.update(beds).set({ status: 'CLEANING', updatedAt: new Date() }).where(eq(beds.id, admission.bedId));
    }
    if (input.toBedId) {
      await tx.update(beds).set({ status: 'OCCUPIED', updatedAt: new Date() }).where(eq(beds.id, input.toBedId));
    }

    const [row] = await tx.update(admissions)
      .set({
        wardId: input.toWardId,
        bedId: input.toBedId ?? null,
        departmentId: toWard.departmentId,
        updatedAt: new Date(),
      })
      .where(eq(admissions.id, admissionId))
      .returning();

    return row!;
  });

  await recordTimelineEvent({
    patientId: admission.patientId,
    admissionId,
    eventType: 'PATIENT_TRANSFERRED',
    title: `Transferred to ${toWard.name}`,
    description: input.reason ?? null,
    actorId: user.id,
    departmentId: toWard.departmentId,
    referenceType: 'admission',
    referenceId: admissionId,
    severity: 'ATTENTION',
  });

  await notify({
    recipientId: admission.attendingDoctorId,
    patientId: admission.patientId,
    type: 'PATIENT_TRANSFERRED',
    title: 'Patient transferred',
    message: `Your patient has been transferred to ${toWard.name}.`,
    referenceType: 'admission',
    referenceId: admissionId,
    link: `/patients/${admission.patientId}`,
  });

  await recordAudit({
    action: AUDIT.PATIENT_TRANSFERRED,
    entityType: 'admission',
    entityId: admissionId,
    patientId: admission.patientId,
    actor: user,
    metadata: { fromWardId: admission.wardId, toWardId: input.toWardId },
  });

  return updated;
}

export async function dischargePatient(user: AuthUser, admissionId: string, summary: string) {
  const [admission] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
  if (!admission) throw new AppError('NOT_FOUND', 'Admission could not be found.');
  if (admission.status !== 'ADMITTED') throw new AppError('CONFLICT', 'This admission is not open.');

  await assertPatientAccess(user, admission.patientId);
  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(admissions)
      .set({ status: 'DISCHARGED', dischargeDate: now, dischargeSummary: summary, updatedAt: now })
      .where(eq(admissions.id, admissionId))
      .returning();

    if (admission.bedId) {
      await tx.update(beds).set({ status: 'CLEANING', updatedAt: now }).where(eq(beds.id, admission.bedId));
    }

    await tx.update(encounters)
      .set({ status: 'COMPLETED', endTime: now, updatedAt: now })
      .where(and(eq(encounters.admissionId, admissionId), eq(encounters.status, 'IN_PROGRESS')));

    await tx.update(patients).set({ status: 'STABLE', updatedAt: now }).where(eq(patients.id, admission.patientId));

    return row!;
  });

  await recordTimelineEvent({
    patientId: admission.patientId,
    admissionId,
    eventType: 'PATIENT_DISCHARGED',
    title: 'Discharged',
    description: summary,
    actorId: user.id,
    departmentId: admission.departmentId,
    referenceType: 'admission',
    referenceId: admissionId,
  });

  await recordAudit({
    action: AUDIT.PATIENT_DISCHARGED,
    entityType: 'admission',
    entityId: admissionId,
    patientId: admission.patientId,
    actor: user,
  });

  return updated;
}

export async function listAdmissions(params: { status?: string[]; departmentId?: string; limit?: number } = {}) {
  const conditions = [];
  if (params.status?.length) conditions.push(inArray(admissions.status, params.status as ('ADMITTED' | 'DISCHARGED' | 'TRANSFERRED' | 'CANCELLED')[]));
  if (params.departmentId) conditions.push(eq(admissions.departmentId, params.departmentId));

  return db
    .select({
      id: admissions.id,
      admissionNumber: admissions.admissionNumber,
      admissionDate: admissions.admissionDate,
      dischargeDate: admissions.dischargeDate,
      status: admissions.status,
      reason: admissions.reason,
      patientId: patients.id,
      patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
      patientStatus: patients.status,
      wardName: wards.name,
      bedCode: beds.code,
      departmentName: departments.name,
      attendingDoctorName: users.fullName,
    })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .innerJoin(departments, eq(departments.id, admissions.departmentId))
    .innerJoin(users, eq(users.id, admissions.attendingDoctorId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(admissions.admissionDate))
    .limit(boundedLimit(params.limit, 100));
}

export async function getAdmissionTransfers(admissionId: string) {
  const fromWard = { id: wards.id, name: wards.name };
  return db
    .select({
      id: admissionTransfers.id,
      reason: admissionTransfers.reason,
      transferredAt: admissionTransfers.transferredAt,
      toWardName: fromWard.name,
      performedByName: users.fullName,
    })
    .from(admissionTransfers)
    .leftJoin(wards, eq(wards.id, admissionTransfers.toWardId))
    .innerJoin(users, eq(users.id, admissionTransfers.performedById))
    .where(eq(admissionTransfers.admissionId, admissionId))
    .orderBy(desc(admissionTransfers.transferredAt))
    .limit(MAX_PAGE_SIZE);
}

export async function createWard(user: AuthUser, input: { code: string; name: string; departmentId: string; floor?: string; isCritical?: boolean }) {
  const [ward] = await db.insert(wards).values({
    code: input.code, name: input.name, departmentId: input.departmentId,
    floor: input.floor ?? null, isCritical: input.isCritical ?? false,
  }).returning();
  await recordAudit({ action: AUDIT.WARD_CREATED, entityType: 'ward', entityId: ward!.id, actor: user, metadata: { code: input.code } });
  return ward!;
}

export async function createBed(user: AuthUser, input: { wardId: string; code: string }) {
  const [bed] = await db.insert(beds).values({ wardId: input.wardId, code: input.code }).returning();
  await recordAudit({ action: AUDIT.BED_CREATED, entityType: 'bed', entityId: bed!.id, actor: user, metadata: { code: input.code } });
  return bed!;
}

export async function updateBedStatus(user: AuthUser, bedId: string, status: 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'RESERVED') {
  const [bed] = await db.select().from(beds).where(eq(beds.id, bedId)).limit(1);
  if (!bed) throw new AppError('NOT_FOUND', 'Bed could not be found.');
  if (bed.status === 'OCCUPIED' && status !== 'OCCUPIED') {
    const [occupied] = await db.select({ id: admissions.id }).from(admissions)
      .where(and(eq(admissions.bedId, bedId), eq(admissions.status, 'ADMITTED'))).limit(1);
    if (occupied) throw new AppError('CONFLICT', 'This bed has an active admission. Transfer or discharge the patient first.');
  }
  const [updated] = await db.update(beds).set({ status, updatedAt: new Date() }).where(eq(beds.id, bedId)).returning();
  await recordAudit({ action: AUDIT.BED_STATUS_CHANGED, entityType: 'bed', entityId: bedId, actor: user, metadata: { from: bed.status, to: status } });
  return updated!;
}
