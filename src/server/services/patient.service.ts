import '@/server/only';
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  patients, admissions, wards, beds, departments, users, careTeamMembers,
  vitalSigns, medicationOrders, patientContacts,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { patientVisibilityFilter, assertPatientAccess } from './patient-access.service';
import { nextPatientNumber } from './identifier.service';
import { recordTimelineEvent } from './timeline.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';

export function calculateAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export type PatientListItem = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number;
  gender: string;
  bloodGroup: string;
  status: string;
  allergies: string[];
  admission: {
    id: string;
    admissionNumber: string;
    admissionDate: Date;
    status: string;
    wardName: string | null;
    bedCode: string | null;
    departmentName: string | null;
    attendingDoctorName: string | null;
  } | null;
};

const activeAdmissionJoin = {
  admissionId: admissions.id,
  admissionNumber: admissions.admissionNumber,
  admissionDate: admissions.admissionDate,
  admissionStatus: admissions.status,
  wardName: wards.name,
  bedCode: beds.code,
  departmentName: departments.name,
  attendingDoctorName: users.fullName,
};

function mapListRow(r: Record<string, unknown>): PatientListItem {
  const dob = r.dateOfBirth as Date;
  return {
    id: r.id as string,
    patientNumber: r.patientNumber as string,
    firstName: r.firstName as string,
    lastName: r.lastName as string,
    fullName: `${r.firstName} ${r.lastName}`,
    age: calculateAge(dob),
    gender: r.gender as string,
    bloodGroup: r.bloodGroup as string,
    status: r.status as string,
    allergies: (r.allergies as string[]) ?? [],
    admission: r.admissionId
      ? {
          id: r.admissionId as string,
          admissionNumber: r.admissionNumber as string,
          admissionDate: r.admissionDate as Date,
          status: r.admissionStatus as string,
          wardName: (r.wardName as string) ?? null,
          bedCode: (r.bedCode as string) ?? null,
          departmentName: (r.departmentName as string) ?? null,
          attendingDoctorName: (r.attendingDoctorName as string) ?? null,
        }
      : null,
  };
}

/**
 * Search is authorization-aware: the visibility predicate is part of the SQL,
 * so a user who guesses a patient number still gets an empty result set.
 */
export async function searchPatients(
  user: AuthUser,
  params: { q?: string; status?: string; wardId?: string; page?: number; pageSize?: number; mineOnly?: boolean },
) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 20), 100);

  const conditions: SQL[] = [];

  const visibility = patientVisibilityFilter(user);
  if (visibility) conditions.push(sql`(${visibility})`);

  if (params.q?.trim()) {
    const term = `%${params.q.trim().toLowerCase()}%`;
    conditions.push(sql`(
      lower(${patients.firstName} || ' ' || ${patients.lastName}) LIKE ${term}
      OR lower(${patients.patientNumber}) LIKE ${term}
      OR lower(${patients.lastName} || ' ' || ${patients.firstName}) LIKE ${term}
      OR EXISTS (SELECT 1 FROM ${admissions} sa WHERE sa.patient_id = patients.id AND lower(sa.admission_number) LIKE ${term})
    )`);
  }

  if (params.status) conditions.push(sql`${patients.status} = ${params.status}`);
  if (params.wardId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${admissions} wa WHERE wa.patient_id = patients.id AND wa.ward_id = ${params.wardId} AND wa.status = 'ADMITTED')`);
  }
  if (params.mineOnly) {
    conditions.push(sql`(
      EXISTS (SELECT 1 FROM ${admissions} ma WHERE ma.patient_id = patients.id AND ma.attending_doctor_id = ${user.id} AND ma.status = 'ADMITTED')
      OR EXISTS (SELECT 1 FROM ${careTeamMembers} mc WHERE mc.patient_id = patients.id AND mc.user_id = ${user.id} AND mc.removed_at IS NULL)
    )`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(patients)
    .where(where);

  const rows = await db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      firstName: patients.firstName,
      lastName: patients.lastName,
      dateOfBirth: patients.dateOfBirth,
      gender: patients.gender,
      bloodGroup: patients.bloodGroup,
      status: patients.status,
      allergies: patients.allergies,
      ...activeAdmissionJoin,
    })
    .from(patients)
    .leftJoin(admissions, and(eq(admissions.patientId, patients.id), eq(admissions.status, 'ADMITTED')))
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .leftJoin(departments, eq(departments.id, admissions.departmentId))
    .leftJoin(users, eq(users.id, admissions.attendingDoctorId))
    .where(where)
    .orderBy(desc(sql`CASE ${patients.status} WHEN 'CRITICAL' THEN 2 WHEN 'NEEDS_ATTENTION' THEN 1 ELSE 0 END`), asc(patients.lastName))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows.map(mapListRow), total, page, pageSize };
}

export async function getPatientHeader(user: AuthUser, patientId: string) {
  await assertPatientAccess(user, patientId);

  const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!patient) throw new AppError('PATIENT_NOT_FOUND', 'Patient could not be found.');

  const [admission] = await db
    .select({
      id: admissions.id,
      admissionNumber: admissions.admissionNumber,
      admissionDate: admissions.admissionDate,
      dischargeDate: admissions.dischargeDate,
      status: admissions.status,
      reason: admissions.reason,
      wardId: wards.id,
      wardName: wards.name,
      bedId: beds.id,
      bedCode: beds.code,
      departmentId: departments.id,
      departmentName: departments.name,
      attendingDoctorId: users.id,
      attendingDoctorName: users.fullName,
    })
    .from(admissions)
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .leftJoin(departments, eq(departments.id, admissions.departmentId))
    .leftJoin(users, eq(users.id, admissions.attendingDoctorId))
    .where(eq(admissions.patientId, patientId))
    .orderBy(desc(admissions.admissionDate))
    .limit(1);

  const careTeam = await db
    .select({
      id: careTeamMembers.id,
      role: careTeamMembers.role,
      userId: users.id,
      name: users.fullName,
      userRole: users.primaryRole,
    })
    .from(careTeamMembers)
    .innerJoin(users, eq(users.id, careTeamMembers.userId))
    .where(and(eq(careTeamMembers.patientId, patientId), isNull(careTeamMembers.removedAt)))
    .orderBy(asc(careTeamMembers.assignedAt));

  const [latestVitals] = await db.select().from(vitalSigns)
    .where(eq(vitalSigns.patientId, patientId))
    .orderBy(desc(vitalSigns.recordedAt)).limit(1);

  const activeMeds = await db
    .select({
      id: medicationOrders.id,
      medicineName: medicationOrders.medicineName,
      dose: medicationOrders.dose,
      frequency: medicationOrders.frequency,
      route: medicationOrders.route,
      status: medicationOrders.status,
    })
    .from(medicationOrders)
    .where(and(
      eq(medicationOrders.patientId, patientId),
      or(eq(medicationOrders.status, 'ACTIVE'), eq(medicationOrders.status, 'DISPENSED')),
    ))
    .orderBy(desc(medicationOrders.createdAt))
    .limit(20);

  const contacts = await db.select().from(patientContacts)
    .where(eq(patientContacts.patientId, patientId))
    .orderBy(desc(patientContacts.isPrimary));

  return {
    ...patient,
    fullName: `${patient.firstName} ${patient.lastName}`,
    age: calculateAge(patient.dateOfBirth),
    admission: admission ?? null,
    careTeam,
    latestVitals: latestVitals ?? null,
    activeMedications: activeMeds,
    contacts,
  };
}

export async function recordPatientView(user: AuthUser, patientId: string, ctx?: { ip?: string | null; ua?: string | null }) {
  await recordAudit({
    action: AUDIT.PATIENT_VIEWED,
    entityType: 'patient',
    entityId: patientId,
    patientId,
    actor: user,
    ipAddress: ctx?.ip,
    userAgent: ctx?.ua,
  });
}

export type CreatePatientInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  bloodGroup?: 'A_POSITIVE' | 'A_NEGATIVE' | 'B_POSITIVE' | 'B_NEGATIVE' | 'AB_POSITIVE' | 'AB_NEGATIVE' | 'O_POSITIVE' | 'O_NEGATIVE' | 'UNKNOWN';
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  allergies?: string[];
  chronicConditions?: string[];
  emergencyContact?: { name: string; relationship: string; phone: string; email?: string };
};

export async function createPatient(user: AuthUser, input: CreatePatientInput) {
  const patientNumber = await nextPatientNumber();

  const created = await db.transaction(async (tx) => {
    const [patient] = await tx.insert(patients).values({
      patientNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      bloodGroup: input.bloodGroup ?? 'UNKNOWN',
      phone: input.phone ?? null,
      email: input.email ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      allergies: input.allergies ?? [],
      chronicConditions: input.chronicConditions ?? [],
      createdById: user.id,
    }).returning();

    if (input.emergencyContact) {
      await tx.insert(patientContacts).values({
        patientId: patient!.id,
        name: input.emergencyContact.name,
        relationship: input.emergencyContact.relationship,
        phone: input.emergencyContact.phone,
        email: input.emergencyContact.email ?? null,
        isPrimary: true,
      });
    }

    // The registering clinician keeps access to the record they created.
    await tx.insert(careTeamMembers).values({
      patientId: patient!.id,
      userId: user.id,
      role: 'CONSULTING',
      assignedById: user.id,
    });

    return patient!;
  });

  await recordAudit({
    action: AUDIT.PATIENT_CREATED,
    entityType: 'patient',
    entityId: created.id,
    patientId: created.id,
    actor: user,
    metadata: { patientNumber },
  });

  return created;
}

export async function updatePatient(
  user: AuthUser,
  patientId: string,
  input: Partial<CreatePatientInput> & { status?: 'STABLE' | 'NEEDS_ATTENTION' | 'CRITICAL'; notes?: string },
) {
  await assertPatientAccess(user, patientId);

  const [updated] = await db.update(patients).set({
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    ...(input.bloodGroup !== undefined ? { bloodGroup: input.bloodGroup } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
    ...(input.allergies !== undefined ? { allergies: input.allergies } : {}),
    ...(input.chronicConditions !== undefined ? { chronicConditions: input.chronicConditions } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    updatedAt: new Date(),
  }).where(eq(patients.id, patientId)).returning();

  if (!updated) throw new AppError('PATIENT_NOT_FOUND', 'Patient could not be found.');

  await recordAudit({
    action: AUDIT.PATIENT_UPDATED,
    entityType: 'patient',
    entityId: patientId,
    patientId,
    actor: user,
    metadata: { fields: Object.keys(input) },
  });

  if (input.status) {
    await recordTimelineEvent({
      patientId,
      eventType: 'OBSERVATION_RECORDED',
      title: `Patient status set to ${input.status.replace('_', ' ').toLowerCase()}`,
      actorId: user.id,
      severity: input.status === 'CRITICAL' ? 'CRITICAL' : input.status === 'NEEDS_ATTENTION' ? 'ATTENTION' : 'INFO',
      referenceType: 'patient',
      referenceId: patientId,
    });
  }

  return updated;
}
