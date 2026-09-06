import '@/server/only';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, type Db } from '@/server/db/client';
import { timelineEvents, users, departments } from '@/server/db/schema';

export type TimelineEventType =
  | 'ADMISSION_CREATED' | 'PATIENT_TRANSFERRED' | 'PATIENT_DISCHARGED' | 'ENCOUNTER_STARTED'
  | 'CLINICAL_NOTE' | 'VITALS_RECORDED' | 'OBSERVATION_RECORDED' | 'INVESTIGATION_ORDERED'
  | 'LAB_RESULT' | 'RADIOLOGY_REPORT' | 'MEDICATION_ORDERED' | 'MEDICATION_UPDATED'
  | 'MEDICATION_ADMINISTERED' | 'REFERRAL_CREATED' | 'REFERRAL_ACCEPTED' | 'REFERRAL_DECLINED'
  | 'REFERRAL_INFORMATION_REQUESTED' | 'REFERRAL_RESPONSE' | 'REFERRAL_COMPLETED'
  | 'AI_SUMMARY' | 'DOCUMENT_UPLOADED';

export type RecordEventInput = {
  patientId: string;
  admissionId?: string | null;
  encounterId?: string | null;
  eventType: TimelineEventType;
  title: string;
  description?: string | null;
  actorId?: string | null;
  departmentId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  severity?: 'INFO' | 'ATTENTION' | 'CRITICAL';
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
};

/**
 * The patient timeline is a persisted, append-only projection rather than a
 * UNION over a dozen tables: it paginates correctly, sorts deterministically,
 * and lets every department contribute without the read path growing a join
 * for each new module.
 */
export async function recordTimelineEvent(input: RecordEventInput, tx: Db | typeof db = db): Promise<void> {
  await tx.insert(timelineEvents).values({
    patientId: input.patientId,
    admissionId: input.admissionId ?? null,
    encounterId: input.encounterId ?? null,
    eventType: input.eventType,
    title: input.title,
    description: input.description ?? null,
    actorId: input.actorId ?? null,
    departmentId: input.departmentId ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    severity: input.severity ?? 'INFO',
    metadata: input.metadata ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  });
}

export type TimelineItem = {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  severity: string;
  occurredAt: Date;
  referenceType: string | null;
  referenceId: string | null;
  metadata: unknown;
  actor: { id: string; name: string; role: string } | null;
  department: { id: string; name: string } | null;
};

export async function getPatientTimeline(params: {
  patientId: string;
  limit?: number;
  cursor?: string | null;
  types?: TimelineEventType[];
}): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
  const limit = Math.min(params.limit ?? 25, 100);

  const conditions = [eq(timelineEvents.patientId, params.patientId)];
  if (params.cursor) conditions.push(lt(timelineEvents.occurredAt, new Date(params.cursor)));
  if (params.types?.length) conditions.push(inArray(timelineEvents.eventType, params.types));

  const rows = await db
    .select({
      id: timelineEvents.id,
      eventType: timelineEvents.eventType,
      title: timelineEvents.title,
      description: timelineEvents.description,
      severity: timelineEvents.severity,
      occurredAt: timelineEvents.occurredAt,
      referenceType: timelineEvents.referenceType,
      referenceId: timelineEvents.referenceId,
      metadata: timelineEvents.metadata,
      actorId: users.id,
      actorName: users.fullName,
      actorRole: users.primaryRole,
      departmentId: departments.id,
      departmentName: departments.name,
    })
    .from(timelineEvents)
    .leftJoin(users, eq(users.id, timelineEvents.actorId))
    .leftJoin(departments, eq(departments.id, timelineEvents.departmentId))
    .where(and(...conditions))
    .orderBy(desc(timelineEvents.occurredAt), desc(timelineEvents.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      title: r.title,
      description: r.description,
      severity: r.severity,
      occurredAt: r.occurredAt,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      metadata: r.metadata,
      actor: r.actorId ? { id: r.actorId, name: r.actorName!, role: r.actorRole! } : null,
      department: r.departmentId ? { id: r.departmentId, name: r.departmentName! } : null,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.occurredAt.toISOString() : null,
  };
}

export async function countPatientEvents(patientId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(timelineEvents)
    .where(eq(timelineEvents.patientId, patientId));
  return row?.count ?? 0;
}
