import '@/server/only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  medicationOrders, medicationAdministrations, medications, patients, users,
  admissions, wards, beds,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { recordTimelineEvent } from './timeline.service';
import { notify } from './notification.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';
import { patientVisibilityFilter } from '@/server/services/patient-access.service';

export type MedicationStatus =
  | 'PENDING' | 'ACTIVE' | 'STOPPED' | 'COMPLETED' | 'PENDING_DISPENSING' | 'DISPENSED';
export type MedicationRoute =
  | 'ORAL' | 'IV' | 'IM' | 'SUBCUTANEOUS' | 'TOPICAL' | 'INHALATION' | 'SUBLINGUAL' | 'RECTAL' | 'OTHER';

export async function listFormulary(query?: string) {
  return db.select().from(medications)
    .where(query
      ? and(eq(medications.isActive, true), sql`lower(${medications.name}) LIKE ${`%${query.toLowerCase()}%`}`)
      : eq(medications.isActive, true))
    .orderBy(medications.name)
    .limit(100);
}

/** Case-insensitive allergy interlock. Returns the matching allergy labels. */
export function detectAllergyConflicts(medicineName: string, allergies: string[]): string[] {
  const med = medicineName.toLowerCase();
  const medWords = med.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return (allergies ?? []).filter((raw) => {
    const allergy = raw.toLowerCase().trim();
    if (!allergy) return false;
    if (med.includes(allergy)) return true;
    return medWords.some((w) => allergy.includes(w));
  });
}

export async function prescribeMedication(
  user: AuthUser,
  input: {
    patientId: string; medicationId?: string; medicineName: string; dose: string;
    frequency: string; route: MedicationRoute; instructions?: string;
    startDate: Date; endDate?: Date; encounterId?: string;
  },
) {
  await assertPatientAccess(user, input.patientId);

  const [patient] = await db.select().from(patients).where(eq(patients.id, input.patientId)).limit(1);
  if (!patient) throw new AppError('PATIENT_NOT_FOUND', 'Patient could not be found.');

  // Allergy interlock: surfaced to the prescriber, never silently overridden.
  const conflicting = detectAllergyConflicts(input.medicineName, patient.allergies ?? []);
  if (conflicting.length) {
    throw new AppError(
      'CONFLICT',
      `${patient.firstName} ${patient.lastName} has a recorded allergy to ${conflicting.join(', ')}. Amend the allergy list or select a different medicine.`,
    );
  }

  const [admission] = await db.select({ id: admissions.id }).from(admissions)
    .where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED'))).limit(1);

  const [order] = await db.insert(medicationOrders).values({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    encounterId: input.encounterId ?? null,
    medicationId: input.medicationId ?? null,
    medicineName: input.medicineName,
    dose: input.dose,
    frequency: input.frequency,
    route: input.route,
    instructions: input.instructions ?? null,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    prescriberId: user.id,
    status: 'PENDING_DISPENSING',
  }).returning();

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    eventType: 'MEDICATION_ORDERED',
    title: `Prescribed ${input.medicineName} ${input.dose}`,
    description: `${input.frequency} | ${input.route}${input.instructions ? ` | ${input.instructions}` : ''}`,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'medication_order',
    referenceId: order!.id,
  });

  await recordAudit({
    action: AUDIT.MEDICATION_CREATED,
    entityType: 'medication_order',
    entityId: order!.id,
    patientId: input.patientId,
    actor: user,
    metadata: { medicineName: input.medicineName, dose: input.dose, route: input.route },
  });

  return order!;
}

export async function updateMedicationStatus(
  user: AuthUser,
  orderId: string,
  input: { status: MedicationStatus; stopReason?: string },
) {
  const [order] = await db.select().from(medicationOrders).where(eq(medicationOrders.id, orderId)).limit(1);
  if (!order) throw new AppError('NOT_FOUND', 'Medication order could not be found.');
  await assertPatientAccess(user, order.patientId);

  if (input.status === 'STOPPED' && !input.stopReason) {
    throw new AppError('VALIDATION_ERROR', 'A reason is required when stopping a medication.');
  }

  const now = new Date();
  const isDispense = input.status === 'DISPENSED';

  const [updated] = await db.update(medicationOrders).set({
    status: input.status,
    stopReason: input.stopReason ?? order.stopReason,
    ...(isDispense ? { dispensedById: user.id, dispensedAt: now } : {}),
    updatedAt: now,
  }).where(eq(medicationOrders.id, orderId)).returning();

  await recordTimelineEvent({
    patientId: order.patientId,
    admissionId: order.admissionId,
    eventType: 'MEDICATION_UPDATED',
    title: `${order.medicineName} — ${input.status.replace('_', ' ').toLowerCase()}`,
    description: input.stopReason ?? null,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'medication_order',
    referenceId: orderId,
    severity: input.status === 'STOPPED' ? 'ATTENTION' : 'INFO',
  });

  if (isDispense && order.prescriberId !== user.id) {
    await notify({
      recipientId: order.prescriberId,
      patientId: order.patientId,
      type: 'MEDICATION_DISPENSED',
      title: 'Medication dispensed',
      message: `${order.medicineName} ${order.dose} has been dispensed by pharmacy.`,
      referenceType: 'medication_order',
      referenceId: orderId,
      link: `/patients/${order.patientId}?tab=medications`,
    });
  }

  await recordAudit({
    action: isDispense ? AUDIT.MEDICATION_DISPENSED : AUDIT.MEDICATION_UPDATED,
    entityType: 'medication_order',
    entityId: orderId,
    patientId: order.patientId,
    actor: user,
    metadata: { from: order.status, to: input.status, stopReason: input.stopReason },
  });

  return updated!;
}

export async function administerMedication(
  user: AuthUser,
  orderId: string,
  input: { doseGiven: string; wasWithheld?: boolean; notes?: string },
) {
  const [order] = await db.select().from(medicationOrders).where(eq(medicationOrders.id, orderId)).limit(1);
  if (!order) throw new AppError('NOT_FOUND', 'Medication order could not be found.');
  await assertPatientAccess(user, order.patientId);

  if (!['ACTIVE', 'DISPENSED'].includes(order.status)) {
    throw new AppError('CONFLICT', 'Only an active or dispensed medication can be administered.');
  }

  const [admin] = await db.insert(medicationAdministrations).values({
    medicationOrderId: orderId,
    administeredById: user.id,
    doseGiven: input.doseGiven,
    wasWithheld: input.wasWithheld ?? false,
    notes: input.notes ?? null,
  }).returning();

  await recordTimelineEvent({
    patientId: order.patientId,
    admissionId: order.admissionId,
    eventType: 'MEDICATION_ADMINISTERED',
    title: input.wasWithheld
      ? `${order.medicineName} withheld`
      : `${order.medicineName} ${input.doseGiven} administered`,
    description: input.notes ?? null,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'medication_administration',
    referenceId: admin!.id,
    severity: input.wasWithheld ? 'ATTENTION' : 'INFO',
  });

  await recordAudit({
    action: AUDIT.MEDICATION_ADMINISTERED,
    entityType: 'medication_administration',
    entityId: admin!.id,
    patientId: order.patientId,
    actor: user,
    metadata: { orderId, wasWithheld: input.wasWithheld ?? false },
  });

  return admin!;
}

/** The dispensing worklist. Visibility-filtered like the other two. */
export async function listMedicationOrders(params: {
  patientId?: string; status?: MedicationStatus[]; limit?: number;
}, viewer?: AuthUser) {
  // A patient-scoped worklist query is a direct object reference: the caller has
  // named a specific patient, so it is answered the way every other patient read
  // is answered — a denial that is audited, not a silently empty list. The
  // visibility filter below still applies, and covers the unscoped worklist.
  if (viewer && params.patientId) await assertPatientAccess(viewer, params.patientId);
  const conditions = [];
  if (params.patientId) conditions.push(eq(medicationOrders.patientId, params.patientId));
  if (viewer) {
    const visible = patientVisibilityFilter(viewer);
    if (visible) conditions.push(visible);
  }
  if (params.status?.length) conditions.push(inArray(medicationOrders.status, params.status));

  return db
    .select({
      id: medicationOrders.id,
      medicineName: medicationOrders.medicineName,
      dose: medicationOrders.dose,
      frequency: medicationOrders.frequency,
      route: medicationOrders.route,
      instructions: medicationOrders.instructions,
      startDate: medicationOrders.startDate,
      endDate: medicationOrders.endDate,
      status: medicationOrders.status,
      stopReason: medicationOrders.stopReason,
      dispensedAt: medicationOrders.dispensedAt,
      createdAt: medicationOrders.createdAt,
      patientId: patients.id,
      patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
      patientAllergies: patients.allergies,
      prescriberName: users.fullName,
      wardName: wards.name,
      bedCode: beds.code,
      administrationCount: sql<number>`(SELECT count(*)::int FROM ${medicationAdministrations} a WHERE a.medication_order_id = medication_orders.id)`,
    })
    .from(medicationOrders)
    .innerJoin(patients, eq(patients.id, medicationOrders.patientId))
    .innerJoin(users, eq(users.id, medicationOrders.prescriberId))
    .leftJoin(admissions, eq(admissions.id, medicationOrders.admissionId))
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(medicationOrders.createdAt))
    .limit(Math.min(params.limit ?? 100, 300));
}

export async function getPatientMedications(user: AuthUser, patientId: string) {
  await assertPatientAccess(user, patientId);
  const orders = await listMedicationOrders({ patientId, limit: 200 });
  const ids = orders.map((o) => o.id);
  const admins = ids.length
    ? await db
        .select({
          id: medicationAdministrations.id,
          medicationOrderId: medicationAdministrations.medicationOrderId,
          doseGiven: medicationAdministrations.doseGiven,
          wasWithheld: medicationAdministrations.wasWithheld,
          notes: medicationAdministrations.notes,
          administeredAt: medicationAdministrations.administeredAt,
          administeredByName: users.fullName,
        })
        .from(medicationAdministrations)
        .innerJoin(users, eq(users.id, medicationAdministrations.administeredById))
        .where(inArray(medicationAdministrations.medicationOrderId, ids))
        .orderBy(desc(medicationAdministrations.administeredAt))
    : [];
  return orders.map((o) => ({ ...o, administrations: admins.filter((a) => a.medicationOrderId === o.id) }));
}
