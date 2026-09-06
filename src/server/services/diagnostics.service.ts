import '@/server/only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  investigations, investigationOrders, investigationResults, radiologyStudies,
  radiologyReports, users, patients, admissions, departments, careTeamMembers,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { nextOrderNumber, nextAccessionNumber } from './identifier.service';
import { recordTimelineEvent } from './timeline.service';
import { notifyMany } from './notification.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';

export type ResultFlag = 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH' | 'ABNORMAL';

/** Derives the abnormal/critical flag from the catalogue reference ranges. */
export function flagForValue(
  value: number | null,
  ranges: { referenceLow?: number | null; referenceHigh?: number | null; criticalLow?: number | null; criticalHigh?: number | null },
): ResultFlag {
  if (value == null) return 'NORMAL';
  if (ranges.criticalLow != null && value <= ranges.criticalLow) return 'CRITICAL_LOW';
  if (ranges.criticalHigh != null && value >= ranges.criticalHigh) return 'CRITICAL_HIGH';
  if (ranges.referenceLow != null && value < ranges.referenceLow) return 'LOW';
  if (ranges.referenceHigh != null && value > ranges.referenceHigh) return 'HIGH';
  return 'NORMAL';
}

export const isCriticalFlag = (f: ResultFlag) => f === 'CRITICAL_LOW' || f === 'CRITICAL_HIGH';

async function clinicalRecipients(patientId: string, exclude?: string): Promise<string[]> {
  const [admission] = await db.select({ attendingDoctorId: admissions.attendingDoctorId })
    .from(admissions)
    .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'ADMITTED')))
    .limit(1);

  const team = await db.select({ userId: careTeamMembers.userId })
    .from(careTeamMembers)
    .where(and(eq(careTeamMembers.patientId, patientId), sql`${careTeamMembers.removedAt} IS NULL`));

  const ids = new Set<string>(team.map((t) => t.userId));
  if (admission?.attendingDoctorId) ids.add(admission.attendingDoctorId);
  if (exclude) ids.delete(exclude);
  return [...ids];
}

/* --------------------------------------------------------- pathology ---- */

export async function listInvestigationCatalog(category?: 'LAB' | 'RADIOLOGY') {
  return db.select().from(investigations)
    .where(category ? and(eq(investigations.isActive, true), eq(investigations.category, category)) : eq(investigations.isActive, true))
    .orderBy(investigations.panel, investigations.name);
}

export async function createLabOrder(
  user: AuthUser,
  input: { patientId: string; panel: string; clinicalInfo?: string; priority?: 'ROUTINE' | 'URGENT' | 'STAT'; encounterId?: string },
) {
  await assertPatientAccess(user, input.patientId);

  const [admission] = await db.select({ id: admissions.id, departmentId: admissions.departmentId })
    .from(admissions).where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED'))).limit(1);

  const orderNumber = await nextOrderNumber('LAB');
  const [order] = await db.insert(investigationOrders).values({
    orderNumber,
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    encounterId: input.encounterId ?? null,
    category: 'LAB',
    panel: input.panel,
    clinicalInfo: input.clinicalInfo ?? null,
    priority: input.priority ?? 'ROUTINE',
    status: 'ORDERED',
    departmentId: admission?.departmentId ?? user.departmentId,
    orderedById: user.id,
  }).returning();

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    eventType: 'INVESTIGATION_ORDERED',
    title: `Lab order — ${input.panel}`,
    description: input.clinicalInfo ?? null,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'investigation_order',
    referenceId: order!.id,
    severity: input.priority === 'STAT' ? 'ATTENTION' : 'INFO',
    metadata: { orderNumber, priority: input.priority ?? 'ROUTINE' },
  });

  await recordAudit({
    action: AUDIT.LAB_ORDER_CREATED,
    entityType: 'investigation_order',
    entityId: order!.id,
    patientId: input.patientId,
    actor: user,
    metadata: { orderNumber, panel: input.panel },
  });

  return order!;
}

export type LabResultInput = { analyte: string; value: string; unit?: string; investigationCode?: string; comment?: string };

export async function recordLabResults(user: AuthUser, orderId: string, results: LabResultInput[]) {
  const [order] = await db.select().from(investigationOrders).where(eq(investigationOrders.id, orderId)).limit(1);
  if (!order) throw new AppError('NOT_FOUND', 'Laboratory order could not be found.');
  if (order.category !== 'LAB') throw new AppError('VALIDATION_ERROR', 'This is not a laboratory order.');

  await assertPatientAccess(user, order.patientId);

  const codes = results.map((r) => r.investigationCode).filter(Boolean) as string[];
  const catalog = codes.length
    ? await db.select().from(investigations).where(inArray(investigations.code, codes))
    : [];
  const byCode = new Map(catalog.map((c) => [c.code, c]));

  const now = new Date();
  const rows = results.map((r) => {
    const cat = r.investigationCode ? byCode.get(r.investigationCode) : undefined;
    const numeric = Number.parseFloat(r.value);
    const numericValue = Number.isFinite(numeric) ? numeric : null;
    const flag = cat ? flagForValue(numericValue, cat) : 'NORMAL';
    const range = cat?.referenceLow != null && cat?.referenceHigh != null
      ? `${cat.referenceLow}–${cat.referenceHigh}${cat.unit ? ` ${cat.unit}` : ''}`
      : null;
    return {
      orderId,
      patientId: order.patientId,
      investigationId: cat?.id ?? null,
      analyte: r.analyte,
      value: r.value,
      numericValue,
      unit: r.unit ?? cat?.unit ?? null,
      referenceRange: range,
      flag: flag as ResultFlag,
      comment: r.comment ?? null,
      resultedById: user.id,
      resultedAt: now,
    };
  });

  const inserted = await db.transaction(async (tx) => {
    const created = await tx.insert(investigationResults).values(rows).returning();
    await tx.update(investigationOrders)
      .set({ status: 'COMPLETED', completedAt: now, updatedAt: now })
      .where(eq(investigationOrders.id, orderId));
    return created;
  });

  const critical = inserted.filter((r) => isCriticalFlag(r.flag as ResultFlag));
  const abnormal = inserted.filter((r) => r.flag !== 'NORMAL');

  await recordTimelineEvent({
    patientId: order.patientId,
    admissionId: order.admissionId,
    eventType: 'LAB_RESULT',
    title: `${order.panel} results available`,
    description: abnormal.length
      ? `${abnormal.length} of ${inserted.length} values outside reference range`
      : `All ${inserted.length} values within reference range`,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'investigation_order',
    referenceId: orderId,
    severity: critical.length ? 'CRITICAL' : abnormal.length ? 'ATTENTION' : 'INFO',
    metadata: { orderNumber: order.orderNumber, abnormal: abnormal.map((a) => a.analyte) },
  });

  const [patient] = await db.select().from(patients).where(eq(patients.id, order.patientId)).limit(1);
  const recipients = await clinicalRecipients(order.patientId, user.id);
  if (!recipients.includes(order.orderedById) && order.orderedById !== user.id) recipients.push(order.orderedById);

  if (critical.length) {
    await notifyMany(recipients, {
      patientId: order.patientId,
      type: 'CRITICAL_LAB_RESULT',
      title: 'Critical laboratory result',
      message: `${patient!.firstName} ${patient!.lastName}: ${critical.map((c) => `${c.analyte} ${c.value}${c.unit ? ' ' + c.unit : ''}`).join(', ')}`,
      referenceType: 'investigation_order',
      referenceId: orderId,
      link: `/patients/${order.patientId}?tab=pathology`,
      severity: 'CRITICAL',
    });
    await db.update(patients).set({ status: 'CRITICAL', updatedAt: now }).where(eq(patients.id, order.patientId));
  } else {
    await notifyMany(recipients, {
      patientId: order.patientId,
      type: 'LAB_RESULT_AVAILABLE',
      title: `${order.panel} results available`,
      message: `${patient!.firstName} ${patient!.lastName} — ${abnormal.length ? `${abnormal.length} abnormal value(s)` : 'all values normal'}`,
      referenceType: 'investigation_order',
      referenceId: orderId,
      link: `/patients/${order.patientId}?tab=pathology`,
      severity: abnormal.length ? 'ATTENTION' : 'INFO',
    });
  }

  await recordAudit({
    action: AUDIT.LAB_RESULT_CREATED,
    entityType: 'investigation_order',
    entityId: orderId,
    patientId: order.patientId,
    actor: user,
    metadata: { count: inserted.length, critical: critical.length },
  });

  return inserted;
}

export async function listLabOrders(params: { patientId?: string; status?: ('ORDERED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED')[]; limit?: number }) {
  const conditions = [eq(investigationOrders.category, 'LAB' as const)];
  if (params.patientId) conditions.push(eq(investigationOrders.patientId, params.patientId));
  if (params.status?.length) conditions.push(inArray(investigationOrders.status, params.status));

  return db
    .select({
      id: investigationOrders.id,
      orderNumber: investigationOrders.orderNumber,
      panel: investigationOrders.panel,
      clinicalInfo: investigationOrders.clinicalInfo,
      priority: investigationOrders.priority,
      status: investigationOrders.status,
      orderedAt: investigationOrders.orderedAt,
      completedAt: investigationOrders.completedAt,
      patientId: patients.id,
      patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
      orderedByName: users.fullName,
      resultCount: sql<number>`(SELECT count(*)::int FROM ${investigationResults} r WHERE r.order_id = investigation_orders.id)`,
      abnormalCount: sql<number>`(SELECT count(*)::int FROM ${investigationResults} r WHERE r.order_id = investigation_orders.id AND r.flag <> 'NORMAL')`,
    })
    .from(investigationOrders)
    .innerJoin(patients, eq(patients.id, investigationOrders.patientId))
    .innerJoin(users, eq(users.id, investigationOrders.orderedById))
    .where(and(...conditions))
    .orderBy(desc(investigationOrders.orderedAt))
    .limit(Math.min(params.limit ?? 100, 300));
}

export async function getPatientLabs(user: AuthUser, patientId: string) {
  await assertPatientAccess(user, patientId);

  const orders = await listLabOrders({ patientId, limit: 100 });
  const orderIds = orders.map((o) => o.id);
  const results = orderIds.length
    ? await db
        .select({
          id: investigationResults.id,
          orderId: investigationResults.orderId,
          analyte: investigationResults.analyte,
          value: investigationResults.value,
          numericValue: investigationResults.numericValue,
          unit: investigationResults.unit,
          referenceRange: investigationResults.referenceRange,
          flag: investigationResults.flag,
          comment: investigationResults.comment,
          resultedAt: investigationResults.resultedAt,
          resultedByName: users.fullName,
        })
        .from(investigationResults)
        .innerJoin(users, eq(users.id, investigationResults.resultedById))
        .where(inArray(investigationResults.orderId, orderIds))
        .orderBy(desc(investigationResults.resultedAt))
    : [];

  return orders.map((o) => ({ ...o, results: results.filter((r) => r.orderId === o.id) }));
}

/** Trend for one analyte over time — powers the pathology sparkline. */
export async function analyteTrend(user: AuthUser, patientId: string, analyte: string) {
  await assertPatientAccess(user, patientId);
  return db
    .select({
      resultedAt: investigationResults.resultedAt,
      numericValue: investigationResults.numericValue,
      unit: investigationResults.unit,
      flag: investigationResults.flag,
    })
    .from(investigationResults)
    .where(and(eq(investigationResults.patientId, patientId), eq(investigationResults.analyte, analyte)))
    .orderBy(investigationResults.resultedAt);
}

/* --------------------------------------------------------- radiology ---- */

export async function createRadiologyStudy(
  user: AuthUser,
  input: {
    patientId: string; modality: 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND' | 'OTHER';
    bodyPart: string; description: string; clinicalInfo?: string;
    contrastUsed?: boolean; priority?: 'ROUTINE' | 'URGENT' | 'STAT'; encounterId?: string;
  },
) {
  await assertPatientAccess(user, input.patientId);

  const [admission] = await db.select({ id: admissions.id, departmentId: admissions.departmentId })
    .from(admissions).where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, 'ADMITTED'))).limit(1);

  const orderNumber = await nextOrderNumber('RAD');
  const accessionNumber = await nextAccessionNumber();

  const study = await db.transaction(async (tx) => {
    const [order] = await tx.insert(investigationOrders).values({
      orderNumber,
      patientId: input.patientId,
      admissionId: admission?.id ?? null,
      encounterId: input.encounterId ?? null,
      category: 'RADIOLOGY',
      panel: `${input.modality} ${input.bodyPart}`,
      clinicalInfo: input.clinicalInfo ?? null,
      priority: input.priority ?? 'ROUTINE',
      status: 'ORDERED',
      departmentId: admission?.departmentId ?? user.departmentId,
      orderedById: user.id,
    }).returning();

    const [row] = await tx.insert(radiologyStudies).values({
      accessionNumber,
      patientId: input.patientId,
      admissionId: admission?.id ?? null,
      encounterId: input.encounterId ?? null,
      orderId: order!.id,
      modality: input.modality,
      bodyPart: input.bodyPart,
      description: input.description,
      clinicalInfo: input.clinicalInfo ?? null,
      contrastUsed: input.contrastUsed ?? false,
      priority: input.priority ?? 'ROUTINE',
      status: 'ORDERED',
      requestedById: user.id,
    }).returning();

    return row!;
  });

  await recordTimelineEvent({
    patientId: input.patientId,
    admissionId: admission?.id ?? null,
    eventType: 'INVESTIGATION_ORDERED',
    title: `Imaging requested — ${input.modality} ${input.bodyPart}`,
    description: input.description,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'radiology_study',
    referenceId: study.id,
    severity: input.priority === 'STAT' ? 'ATTENTION' : 'INFO',
    metadata: { accessionNumber },
  });

  await recordAudit({
    action: AUDIT.RADIOLOGY_STUDY_CREATED,
    entityType: 'radiology_study',
    entityId: study.id,
    patientId: input.patientId,
    actor: user,
    metadata: { accessionNumber, modality: input.modality },
  });

  return study;
}

export async function reportRadiologyStudy(
  user: AuthUser,
  studyId: string,
  input: { findings: string; impression: string; recommendation?: string; isCritical?: boolean },
) {
  const [study] = await db.select().from(radiologyStudies).where(eq(radiologyStudies.id, studyId)).limit(1);
  if (!study) throw new AppError('NOT_FOUND', 'Radiology study could not be found.');

  await assertPatientAccess(user, study.patientId);
  const now = new Date();

  const report = await db.transaction(async (tx) => {
    const [row] = await tx.insert(radiologyReports).values({
      studyId,
      findings: input.findings,
      impression: input.impression,
      recommendation: input.recommendation ?? null,
      isCritical: input.isCritical ?? false,
      radiologistId: user.id,
    }).returning();

    await tx.update(radiologyStudies)
      .set({ status: 'REPORTED', performedAt: study.performedAt ?? now, updatedAt: now })
      .where(eq(radiologyStudies.id, studyId));

    if (study.orderId) {
      await tx.update(investigationOrders)
        .set({ status: 'COMPLETED', completedAt: now, updatedAt: now })
        .where(eq(investigationOrders.id, study.orderId));
    }

    return row!;
  });

  await recordTimelineEvent({
    patientId: study.patientId,
    admissionId: study.admissionId,
    eventType: 'RADIOLOGY_REPORT',
    title: `${study.modality} ${study.bodyPart} reported`,
    description: input.impression,
    actorId: user.id,
    departmentId: user.departmentId,
    referenceType: 'radiology_study',
    referenceId: studyId,
    severity: input.isCritical ? 'CRITICAL' : 'INFO',
    metadata: { accessionNumber: study.accessionNumber },
  });

  const [patient] = await db.select().from(patients).where(eq(patients.id, study.patientId)).limit(1);
  const recipients = await clinicalRecipients(study.patientId, user.id);
  if (!recipients.includes(study.requestedById)) recipients.push(study.requestedById);

  await notifyMany(recipients, {
    patientId: study.patientId,
    type: 'RADIOLOGY_REPORT_AVAILABLE',
    title: input.isCritical ? 'Critical imaging finding' : 'Radiology report available',
    message: `${patient!.firstName} ${patient!.lastName} — ${study.modality} ${study.bodyPart}: ${input.impression.slice(0, 160)}`,
    referenceType: 'radiology_study',
    referenceId: studyId,
    link: `/patients/${study.patientId}?tab=radiology`,
    severity: input.isCritical ? 'CRITICAL' : 'INFO',
  });

  await recordAudit({
    action: AUDIT.RADIOLOGY_REPORT_CREATED,
    entityType: 'radiology_report',
    entityId: report.id,
    patientId: study.patientId,
    actor: user,
    metadata: { studyId, isCritical: input.isCritical ?? false },
  });

  return report;
}

export async function updateStudyStatus(user: AuthUser, studyId: string, status: 'SCHEDULED' | 'IN_PROGRESS' | 'CANCELLED') {
  const [study] = await db.select().from(radiologyStudies).where(eq(radiologyStudies.id, studyId)).limit(1);
  if (!study) throw new AppError('NOT_FOUND', 'Radiology study could not be found.');
  await assertPatientAccess(user, study.patientId);

  const [updated] = await db.update(radiologyStudies)
    .set({ status, performedAt: status === 'IN_PROGRESS' ? new Date() : study.performedAt, updatedAt: new Date() })
    .where(eq(radiologyStudies.id, studyId))
    .returning();
  return updated!;
}

export async function listRadiologyStudies(params: { patientId?: string; status?: ('ORDERED' | 'SCHEDULED' | 'IN_PROGRESS' | 'REPORTED' | 'CANCELLED')[]; limit?: number }) {
  const conditions = [];
  if (params.patientId) conditions.push(eq(radiologyStudies.patientId, params.patientId));
  if (params.status?.length) conditions.push(inArray(radiologyStudies.status, params.status));

  const studies = await db
    .select({
      id: radiologyStudies.id,
      accessionNumber: radiologyStudies.accessionNumber,
      modality: radiologyStudies.modality,
      bodyPart: radiologyStudies.bodyPart,
      description: radiologyStudies.description,
      clinicalInfo: radiologyStudies.clinicalInfo,
      contrastUsed: radiologyStudies.contrastUsed,
      priority: radiologyStudies.priority,
      status: radiologyStudies.status,
      requestedAt: radiologyStudies.requestedAt,
      performedAt: radiologyStudies.performedAt,
      patientId: patients.id,
      patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
      requestedByName: users.fullName,
      departmentName: departments.name,
    })
    .from(radiologyStudies)
    .innerJoin(patients, eq(patients.id, radiologyStudies.patientId))
    .innerJoin(users, eq(users.id, radiologyStudies.requestedById))
    .leftJoin(admissions, eq(admissions.id, radiologyStudies.admissionId))
    .leftJoin(departments, eq(departments.id, admissions.departmentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(radiologyStudies.requestedAt))
    .limit(Math.min(params.limit ?? 100, 300));

  const ids = studies.map((s) => s.id);
  const reports = ids.length
    ? await db
        .select({
          id: radiologyReports.id,
          studyId: radiologyReports.studyId,
          findings: radiologyReports.findings,
          impression: radiologyReports.impression,
          recommendation: radiologyReports.recommendation,
          isCritical: radiologyReports.isCritical,
          reportedAt: radiologyReports.reportedAt,
          radiologistName: users.fullName,
        })
        .from(radiologyReports)
        .innerJoin(users, eq(users.id, radiologyReports.radiologistId))
        .where(inArray(radiologyReports.studyId, ids))
        .orderBy(desc(radiologyReports.reportedAt))
    : [];

  return studies.map((s) => ({ ...s, reports: reports.filter((r) => r.studyId === s.id) }));
}

export async function getPatientRadiology(user: AuthUser, patientId: string) {
  await assertPatientAccess(user, patientId);
  return listRadiologyStudies({ patientId, limit: 100 });
}

/** Unified investigations view across pathology + imaging for the patient tab. */
export async function getPatientInvestigations(user: AuthUser, patientId: string) {
  await assertPatientAccess(user, patientId);
  return db
    .select({
      id: investigationOrders.id,
      orderNumber: investigationOrders.orderNumber,
      category: investigationOrders.category,
      panel: investigationOrders.panel,
      clinicalInfo: investigationOrders.clinicalInfo,
      priority: investigationOrders.priority,
      status: investigationOrders.status,
      orderedAt: investigationOrders.orderedAt,
      completedAt: investigationOrders.completedAt,
      orderedByName: users.fullName,
      abnormalCount: sql<number>`(SELECT count(*)::int FROM ${investigationResults} r WHERE r.order_id = investigation_orders.id AND r.flag <> 'NORMAL')`,
      resultCount: sql<number>`(SELECT count(*)::int FROM ${investigationResults} r WHERE r.order_id = investigation_orders.id)`,
    })
    .from(investigationOrders)
    .innerJoin(users, eq(users.id, investigationOrders.orderedById))
    .where(eq(investigationOrders.patientId, patientId))
    .orderBy(desc(investigationOrders.orderedAt));
}
