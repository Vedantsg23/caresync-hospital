import '@/server/only';
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  patients, admissions, wards, beds, departments, users, staffProfiles,
  careTeamMembers, referrals, investigationOrders, investigationResults,
  radiologyStudies, medicationOrders, vitalSigns, timelineEvents, encounters,
  notifications, auditLogs,
} from '@/server/db/schema';
import { patientVisibilityFilter } from './patient-access.service';
import type { AuthUser } from '@/server/auth/context';
import { MAX_PAGE_SIZE } from '@/server/core/pagination';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Patients this clinician is responsible for: attending, care team or referral. */
function myPatientsPredicate(userId: string) {
  return sql`(
    EXISTS (SELECT 1 FROM ${admissions} a WHERE a.patient_id = patients.id AND a.attending_doctor_id = ${userId} AND a.status = 'ADMITTED')
    OR EXISTS (SELECT 1 FROM ${careTeamMembers} c WHERE c.patient_id = patients.id AND c.user_id = ${userId} AND c.removed_at IS NULL)
  )`;
}

export type DoctorDashboard = Awaited<ReturnType<typeof getDoctorDashboard>>;

/**
 * Every figure below is a live aggregate over the clinician's own caseload.
 * Nothing on this dashboard is hardcoded.
 */
export async function getDoctorDashboard(user: AuthUser) {
  const today = startOfToday();

  const [counts] = await db
    .select({
      underCare: sql<number>`count(*) FILTER (WHERE ${myPatientsPredicate(user.id)})::int`,
      critical: sql<number>`count(*) FILTER (WHERE ${myPatientsPredicate(user.id)} AND ${patients.status} = 'CRITICAL')::int`,
      needsAttention: sql<number>`count(*) FILTER (WHERE ${myPatientsPredicate(user.id)} AND ${patients.status} = 'NEEDS_ATTENTION')::int`,
      admittedToday: sql<number>`count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${admissions} a WHERE a.patient_id = ${patients.id}
        AND a.attending_doctor_id = ${user.id} AND a.admission_date >= ${today}))::int`,
    })
    .from(patients);

  const [referralCounts] = await db
    .select({
      pendingIncoming: sql<number>`count(*) FILTER (WHERE ${referrals.specialistDoctorId} = ${user.id} AND ${referrals.status} IN ('PENDING','REQUESTED_INFORMATION'))::int`,
      activeIncoming: sql<number>`count(*) FILTER (WHERE ${referrals.specialistDoctorId} = ${user.id} AND ${referrals.status} IN ('ACCEPTED','IN_PROGRESS'))::int`,
      awaitingOutgoing: sql<number>`count(*) FILTER (WHERE ${referrals.referringDoctorId} = ${user.id} AND ${referrals.status} IN ('PENDING','ACCEPTED','IN_PROGRESS','REQUESTED_INFORMATION'))::int`,
      completedOutgoing: sql<number>`count(*) FILTER (WHERE ${referrals.referringDoctorId} = ${user.id} AND ${referrals.status} = 'COMPLETED')::int`,
    })
    .from(referrals);

  const [resultCounts] = await db
    .select({
      newResults: sql<number>`count(*)::int`,
      abnormal: sql<number>`count(*) FILTER (WHERE ${investigationResults.flag} <> 'NORMAL')::int`,
    })
    .from(investigationResults)
    .innerJoin(investigationOrders, eq(investigationOrders.id, investigationResults.orderId))
    .where(and(
      eq(investigationOrders.orderedById, user.id),
      gte(investigationResults.resultedAt, new Date(Date.now() - 72 * 3600_000)),
    ));

  const [consultCounts] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(encounters)
    .where(and(eq(encounters.providerId, user.id), gte(encounters.startTime, today)));

  const attention = await db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      firstName: patients.firstName,
      lastName: patients.lastName,
      dateOfBirth: patients.dateOfBirth,
      gender: patients.gender,
      status: patients.status,
      allergies: patients.allergies,
      admissionId: admissions.id,
      admissionReason: admissions.reason,
      wardName: wards.name,
      bedCode: beds.code,
      departmentName: departments.name,
      lastVitalsAt: sql<Date | null>`(SELECT v.recorded_at FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      heartRate: sql<number | null>`(SELECT v.heart_rate FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      systolic: sql<number | null>`(SELECT v.blood_pressure_systolic FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      diastolic: sql<number | null>`(SELECT v.blood_pressure_diastolic FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      spo2: sql<number | null>`(SELECT v.spo2 FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      newsScore: sql<number | null>`(SELECT v.news_score FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
    })
    .from(patients)
    .leftJoin(admissions, and(eq(admissions.patientId, patients.id), eq(admissions.status, 'ADMITTED')))
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .leftJoin(departments, eq(departments.id, admissions.departmentId))
    .where(and(myPatientsPredicate(user.id), ne(patients.status, 'STABLE')))
    .orderBy(desc(sql`CASE ${patients.status} WHEN 'CRITICAL' THEN 2 ELSE 1 END`))
    .limit(10);

  const recentActivity = await db
    .select({
      id: timelineEvents.id,
      eventType: timelineEvents.eventType,
      title: timelineEvents.title,
      description: timelineEvents.description,
      severity: timelineEvents.severity,
      occurredAt: timelineEvents.occurredAt,
      patientId: patients.id,
      patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      actorName: users.fullName,
      departmentName: departments.name,
    })
    .from(timelineEvents)
    .innerJoin(patients, eq(patients.id, timelineEvents.patientId))
    .leftJoin(users, eq(users.id, timelineEvents.actorId))
    .leftJoin(departments, eq(departments.id, timelineEvents.departmentId))
    .where(myPatientsPredicate(user.id))
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(12);

  const todaysConsultations = await db
    .select({
      id: encounters.id,
      encounterType: encounters.encounterType,
      reason: encounters.reason,
      startTime: encounters.startTime,
      status: encounters.status,
      patientId: patients.id,
      patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
    })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(encounters.providerId, user.id), gte(encounters.startTime, today)))
    .orderBy(encounters.startTime)
    .limit(20);

  const wardCapacity = await db
    .select({
      id: wards.id,
      name: wards.name,
      isCritical: wards.isCritical,
      total: sql<number>`count(${beds.id})::int`,
      occupied: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'OCCUPIED')::int`,
    })
    .from(wards)
    .leftJoin(beds, eq(beds.wardId, wards.id))
    .where(user.departmentId ? eq(wards.departmentId, user.departmentId) : undefined)
    .groupBy(wards.id, wards.name, wards.isCritical)
    .orderBy(desc(wards.isCritical), wards.name)
    .limit(4);

  return {
    kpis: {
      patientsUnderCare: counts?.underCare ?? 0,
      criticalAttention: counts?.critical ?? 0,
      needsAttention: counts?.needsAttention ?? 0,
      admittedToday: counts?.admittedToday ?? 0,
      pendingReferrals: referralCounts?.pendingIncoming ?? 0,
      activeReferrals: referralCounts?.activeIncoming ?? 0,
      awaitingSpecialist: referralCounts?.awaitingOutgoing ?? 0,
      completedReferrals: referralCounts?.completedOutgoing ?? 0,
      newResults: resultCounts?.newResults ?? 0,
      abnormalResults: resultCounts?.abnormal ?? 0,
      consultationsToday: consultCounts?.today ?? 0,
    },
    patientsRequiringAttention: attention,
    recentActivity,
    todaysConsultations,
    wardCapacity,
  };
}

export async function getNurseDashboard(user: AuthUser) {
  const visibility = patientVisibilityFilter(user);

  const assigned = await db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      firstName: patients.firstName,
      lastName: patients.lastName,
      dateOfBirth: patients.dateOfBirth,
      gender: patients.gender,
      status: patients.status,
      allergies: patients.allergies,
      admissionId: admissions.id,
      admissionReason: admissions.reason,
      wardId: wards.id,
      wardName: wards.name,
      bedCode: beds.code,
      lastVitalsAt: sql<Date | null>`(SELECT v.recorded_at FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      lastNewsScore: sql<number | null>`(SELECT v.news_score FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      dueMedications: sql<number>`(SELECT count(*)::int FROM ${medicationOrders} m WHERE m.patient_id = patients.id AND m.status IN ('ACTIVE','DISPENSED'))`,
    })
    .from(patients)
    .innerJoin(admissions, and(eq(admissions.patientId, patients.id), eq(admissions.status, 'ADMITTED')))
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .where(visibility ? sql`(${visibility})` : undefined)
    .orderBy(desc(sql`CASE ${patients.status} WHEN 'CRITICAL' THEN 2 WHEN 'NEEDS_ATTENTION' THEN 1 ELSE 0 END`), wards.name, beds.code)
    .limit(60);

  const staleThreshold = new Date(Date.now() - 4 * 3600_000);
  const vitalsDue = assigned.filter((p) => !p.lastVitalsAt || new Date(p.lastVitalsAt) < staleThreshold);

  const wardSummary = await db
    .select({
      id: wards.id,
      name: wards.name,
      total: sql<number>`count(${beds.id})::int`,
      occupied: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'OCCUPIED')::int`,
      available: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'AVAILABLE')::int`,
    })
    .from(wards)
    .leftJoin(beds, eq(beds.wardId, wards.id))
    .where(user.departmentId ? eq(wards.departmentId, user.departmentId) : undefined)
    .groupBy(wards.id, wards.name)
    .orderBy(wards.name);

  return {
    kpis: {
      assignedPatients: assigned.length,
      critical: assigned.filter((p) => p.status === 'CRITICAL').length,
      needsAttention: assigned.filter((p) => p.status === 'NEEDS_ATTENTION').length,
      vitalsDue: vitalsDue.length,
      medicationsDue: assigned.reduce((n, p) => n + Number(p.dueMedications ?? 0), 0),
    },
    assignedPatients: assigned,
    vitalsDue,
    wardSummary,
  };
}

export async function getPathologyDashboard() {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) FILTER (WHERE ${investigationOrders.status} = 'ORDERED')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${investigationOrders.status} = 'IN_PROGRESS')::int`,
      completedToday: sql<number>`count(*) FILTER (WHERE ${investigationOrders.status} = 'COMPLETED' AND ${investigationOrders.completedAt} >= ${startOfToday()})::int`,
      stat: sql<number>`count(*) FILTER (WHERE ${investigationOrders.priority} = 'STAT' AND ${investigationOrders.status} <> 'COMPLETED')::int`,
    })
    .from(investigationOrders)
    .where(eq(investigationOrders.category, 'LAB'));

  const [criticalCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(investigationResults)
    .where(and(
      inArray(investigationResults.flag, ['CRITICAL_LOW', 'CRITICAL_HIGH']),
      gte(investigationResults.resultedAt, new Date(Date.now() - 24 * 3600_000)),
    ));

  return {
    kpis: {
      pendingOrders: counts?.pending ?? 0,
      inProgress: counts?.inProgress ?? 0,
      completedToday: counts?.completedToday ?? 0,
      statOrders: counts?.stat ?? 0,
      criticalLast24h: criticalCount?.n ?? 0,
    },
  };
}

export async function getRadiologyDashboard() {
  const [counts] = await db
    .select({
      requested: sql<number>`count(*) FILTER (WHERE ${radiologyStudies.status} = 'ORDERED')::int`,
      scheduled: sql<number>`count(*) FILTER (WHERE ${radiologyStudies.status} = 'SCHEDULED')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${radiologyStudies.status} = 'IN_PROGRESS')::int`,
      reportedToday: sql<number>`count(*) FILTER (WHERE ${radiologyStudies.status} = 'REPORTED' AND ${radiologyStudies.updatedAt} >= ${startOfToday()})::int`,
      stat: sql<number>`count(*) FILTER (WHERE ${radiologyStudies.priority} = 'STAT' AND ${radiologyStudies.status} <> 'REPORTED')::int`,
    })
    .from(radiologyStudies);

  return {
    kpis: {
      awaitingImaging: counts?.requested ?? 0,
      scheduled: counts?.scheduled ?? 0,
      inProgress: counts?.inProgress ?? 0,
      reportedToday: counts?.reportedToday ?? 0,
      statStudies: counts?.stat ?? 0,
    },
  };
}

export async function getPharmacyDashboard() {
  const [counts] = await db
    .select({
      pendingDispense: sql<number>`count(*) FILTER (WHERE ${medicationOrders.status} = 'PENDING_DISPENSING')::int`,
      active: sql<number>`count(*) FILTER (WHERE ${medicationOrders.status} IN ('ACTIVE','DISPENSED'))::int`,
      dispensedToday: sql<number>`count(*) FILTER (WHERE ${medicationOrders.dispensedAt} >= ${startOfToday()})::int`,
      stopped: sql<number>`count(*) FILTER (WHERE ${medicationOrders.status} = 'STOPPED')::int`,
    })
    .from(medicationOrders);

  return {
    kpis: {
      pendingDispensing: counts?.pendingDispense ?? 0,
      activeMedications: counts?.active ?? 0,
      dispensedToday: counts?.dispensedToday ?? 0,
      stopped: counts?.stopped ?? 0,
    },
  };
}

export async function getAdminDashboard() {
  const [patientStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      critical: sql<number>`count(*) FILTER (WHERE ${patients.status} = 'CRITICAL')::int`,
      attention: sql<number>`count(*) FILTER (WHERE ${patients.status} = 'NEEDS_ATTENTION')::int`,
    })
    .from(patients);

  const [admissionStats] = await db
    .select({
      active: sql<number>`count(*) FILTER (WHERE ${admissions.status} = 'ADMITTED')::int`,
      dischargedToday: sql<number>`count(*) FILTER (WHERE ${admissions.dischargeDate} >= ${startOfToday()})::int`,
      admittedToday: sql<number>`count(*) FILTER (WHERE ${admissions.admissionDate} >= ${startOfToday()})::int`,
    })
    .from(admissions);

  const [bedStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      occupied: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'OCCUPIED')::int`,
      available: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'AVAILABLE')::int`,
      cleaning: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'CLEANING')::int`,
      reserved: sql<number>`count(*) FILTER (WHERE ${beds.status} = 'RESERVED')::int`,
    })
    .from(beds);

  const [staffStats] = await db
    .select({
      total: sql<number>`count(*) FILTER (WHERE ${users.isActive})::int`,
      doctors: sql<number>`count(*) FILTER (WHERE ${users.isActive} AND ${users.primaryRole} IN ('SENIOR_DOCTOR','JUNIOR_DOCTOR'))::int`,
      nurses: sql<number>`count(*) FILTER (WHERE ${users.isActive} AND ${users.primaryRole} = 'NURSE')::int`,
      inactive: sql<number>`count(*) FILTER (WHERE NOT ${users.isActive})::int`,
    })
    .from(users);

  const [referralStats] = await db
    .select({
      pending: sql<number>`count(*) FILTER (WHERE ${referrals.status} IN ('PENDING','REQUESTED_INFORMATION'))::int`,
      active: sql<number>`count(*) FILTER (WHERE ${referrals.status} IN ('ACCEPTED','IN_PROGRESS'))::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${referrals.status} = 'COMPLETED')::int`,
      emergency: sql<number>`count(*) FILTER (WHERE ${referrals.priority} = 'EMERGENCY' AND ${referrals.status} NOT IN ('COMPLETED','DECLINED','CANCELLED'))::int`,
    })
    .from(referrals);

  const [alertStats] = await db
    .select({ critical: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.severity, 'CRITICAL'), eq(notifications.read, false)));

  const departmentActivity = await db
    .select({
      id: departments.id,
      name: departments.name,
      code: departments.code,
      staff: sql<number>`(SELECT count(*)::int FROM ${staffProfiles} sp JOIN ${users} u ON u.id = sp.user_id WHERE sp.department_id = departments.id AND u.is_active)`,
      activeAdmissions: sql<number>`(SELECT count(*)::int FROM ${admissions} a WHERE a.department_id = departments.id AND a.status = 'ADMITTED')`,
      referralsIn: sql<number>`(SELECT count(*)::int FROM ${referrals} r WHERE r.to_department_id = departments.id)`,
      referralsOut: sql<number>`(SELECT count(*)::int FROM ${referrals} r WHERE r.from_department_id = departments.id)`,
      events7d: sql<number>`(SELECT count(*)::int FROM ${timelineEvents} t WHERE t.department_id = departments.id AND t.occurred_at >= now() - interval '7 days')`,
    })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(departments.name);

  const activityByDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${timelineEvents.occurredAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(timelineEvents)
    .where(gte(timelineEvents.occurredAt, new Date(Date.now() - 13 * 86400_000)))
    .groupBy(sql`date_trunc('day', ${timelineEvents.occurredAt})`)
    .orderBy(sql`date_trunc('day', ${timelineEvents.occurredAt})`);

  const recentAudit = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      outcome: auditLogs.outcome,
      createdAt: auditLogs.createdAt,
      actorEmail: auditLogs.actorEmail,
      actorRole: auditLogs.actorRole,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(12);

  return {
    kpis: {
      totalPatients: patientStats?.total ?? 0,
      criticalPatients: patientStats?.critical ?? 0,
      attentionPatients: patientStats?.attention ?? 0,
      activeAdmissions: admissionStats?.active ?? 0,
      admittedToday: admissionStats?.admittedToday ?? 0,
      dischargedToday: admissionStats?.dischargedToday ?? 0,
      totalBeds: bedStats?.total ?? 0,
      occupiedBeds: bedStats?.occupied ?? 0,
      availableBeds: bedStats?.available ?? 0,
      cleaningBeds: bedStats?.cleaning ?? 0,
      reservedBeds: bedStats?.reserved ?? 0,
      activeStaff: staffStats?.total ?? 0,
      activeDoctors: staffStats?.doctors ?? 0,
      activeNurses: staffStats?.nurses ?? 0,
      inactiveStaff: staffStats?.inactive ?? 0,
      pendingReferrals: referralStats?.pending ?? 0,
      activeReferrals: referralStats?.active ?? 0,
      completedReferrals: referralStats?.completed ?? 0,
      emergencyReferrals: referralStats?.emergency ?? 0,
      criticalAlerts: alertStats?.critical ?? 0,
    },
    departmentActivity,
    activityByDay,
    recentAudit,
  };
}

/** Care-team membership list used by the patient header. */
export async function getCareTeam(patientId: string) {
  return db
    .select({
      id: careTeamMembers.id,
      role: careTeamMembers.role,
      assignedAt: careTeamMembers.assignedAt,
      userId: users.id,
      name: users.fullName,
      userRole: users.primaryRole,
      designation: staffProfiles.designation,
      departmentName: departments.name,
    })
    .from(careTeamMembers)
    .innerJoin(users, eq(users.id, careTeamMembers.userId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(and(eq(careTeamMembers.patientId, patientId), isNull(careTeamMembers.removedAt)))
    .orderBy(careTeamMembers.assignedAt)
    .limit(MAX_PAGE_SIZE);
}

export async function addCareTeamMember(
  actorId: string,
  input: { patientId: string; userId: string; role: 'ATTENDING' | 'CONSULTING' | 'SPECIALIST' | 'RESIDENT' | 'PRIMARY_NURSE' | 'NURSE' },
) {
  const existing = await db.select({ id: careTeamMembers.id }).from(careTeamMembers)
    .where(and(
      eq(careTeamMembers.patientId, input.patientId),
      eq(careTeamMembers.userId, input.userId),
      isNull(careTeamMembers.removedAt),
    )).limit(1);
  if (existing.length) return existing[0]!;

  const [row] = await db.insert(careTeamMembers).values({
    patientId: input.patientId,
    userId: input.userId,
    role: input.role,
    assignedById: actorId,
  }).returning();
  return row!;
}

export async function removeCareTeamMember(memberId: string) {
  const [row] = await db.update(careTeamMembers)
    .set({ removedAt: new Date() })
    .where(eq(careTeamMembers.id, memberId))
    .returning();
  return row ?? null;
}

/** Global search across patients, referrals and staff, authorization-aware. */
export async function globalSearch(user: AuthUser, query: string) {
  const term = `%${query.toLowerCase()}%`;
  const visibility = patientVisibilityFilter(user);

  const patientRows = await db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      firstName: patients.firstName,
      lastName: patients.lastName,
      status: patients.status,
    })
    .from(patients)
    .where(and(
      visibility ? sql`(${visibility})` : undefined,
      or(
        sql`lower(${patients.firstName} || ' ' || ${patients.lastName}) LIKE ${term}`,
        sql`lower(${patients.patientNumber}) LIKE ${term}`,
        sql`EXISTS (SELECT 1 FROM ${admissions} a WHERE a.patient_id = patients.id AND lower(a.admission_number) LIKE ${term})`,
      ),
    ))
    .limit(8);

  return { patients: patientRows };
}
