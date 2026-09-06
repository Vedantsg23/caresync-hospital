import '@/server/only';
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  aiSummaries, patients, admissions, wards, beds, users, vitalSigns,
  medicationOrders, investigationOrders, investigationResults, radiologyStudies,
  radiologyReports, referrals, timelineEvents, careTeamMembers,
} from '@/server/db/schema';
import { getEnv } from '@/lib/env';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from '../patient-access.service';
import { recordTimelineEvent } from '../timeline.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import { calculateAge } from '../patient.service';
import type { AuthUser } from '@/server/auth/context';
import type { AiKind, AiProvider, AiResult } from './provider';
import { HeuristicAiProvider } from './heuristic.provider';
import { HostedAiProvider } from './hosted.provider';

export const AI_REVIEW_BANNER = 'AI-generated assistance - review required.';

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const env = getEnv();
  if ((env.AI_PROVIDER === 'anthropic' || env.AI_PROVIDER === 'openai') && env.AI_API_KEY) {
    cached = new HostedAiProvider(env.AI_PROVIDER, env.AI_API_KEY, env.AI_MODEL);
  } else {
    cached = new HeuristicAiProvider();
  }
  return cached;
}

/** Test seam. */
export function __setAiProvider(p: AiProvider | null) { cached = p; }

const INSTRUCTIONS: Record<AiKind, string> = {
  PATIENT_SUMMARY: 'Summarise this patient\'s current clinical picture for a clinician who is picking up their care.',
  TIMELINE_SUMMARY: 'Summarise what has happened to this patient over the given period.',
  LAB_SUMMARY: 'Summarise these laboratory results, highlighting values outside their reference range.',
  RADIOLOGY_SUMMARY: 'Summarise these imaging studies and their reported impressions.',
  HANDOVER_SUMMARY: 'Produce a shift handover summary for the listed patients.',
  REFERRAL_BRIEF: 'Brief the receiving specialist on this referral.',
};

/** Assembles the authorised facts for a patient-level summary. */
async function collectPatientFacts(patientId: string) {
  const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!patient) throw new AppError('PATIENT_NOT_FOUND', 'Patient could not be found.');

  const [admission] = await db
    .select({
      reason: admissions.reason,
      admissionDate: admissions.admissionDate,
      wardName: wards.name,
      bedCode: beds.code,
      attendingName: users.fullName,
    })
    .from(admissions)
    .leftJoin(wards, eq(wards.id, admissions.wardId))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .leftJoin(users, eq(users.id, admissions.attendingDoctorId))
    .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'ADMITTED')))
    .limit(1);

  const [latestVitals] = await db.select().from(vitalSigns)
    .where(eq(vitalSigns.patientId, patientId))
    .orderBy(desc(vitalSigns.recordedAt)).limit(1);

  const meds = await db
    .select({ name: medicationOrders.medicineName, dose: medicationOrders.dose, frequency: medicationOrders.frequency })
    .from(medicationOrders)
    .where(and(eq(medicationOrders.patientId, patientId), inArray(medicationOrders.status, ['ACTIVE', 'DISPENSED'])))
    .limit(20);

  const abnormalLabs = await db
    .select({ analyte: investigationResults.analyte, value: investigationResults.value, flag: investigationResults.flag })
    .from(investigationResults)
    .where(and(eq(investigationResults.patientId, patientId), sql`${investigationResults.flag} <> 'NORMAL'`))
    .orderBy(desc(investigationResults.resultedAt))
    .limit(12);

  const openReferrals = await db
    .select({ specialist: users.fullName, status: referrals.status, reason: referrals.reason })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.specialistDoctorId))
    .where(and(eq(referrals.patientId, patientId), inArray(referrals.status, ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'REQUESTED_INFORMATION'])))
    .limit(10);

  const lengthOfStayDays = admission?.admissionDate
    ? Math.max(0, Math.floor((Date.now() - new Date(admission.admissionDate).getTime()) / 86400_000))
    : null;

  return {
    name: `${patient.firstName} ${patient.lastName}`,
    patientNumber: patient.patientNumber,
    age: calculateAge(patient.dateOfBirth),
    gender: patient.gender,
    status: patient.status,
    allergies: patient.allergies ?? [],
    chronicConditions: patient.chronicConditions ?? [],
    ward: admission?.wardName ?? null,
    bed: admission?.bedCode ?? null,
    attendingDoctor: admission?.attendingName ?? null,
    admissionReason: admission?.reason ?? null,
    lengthOfStayDays,
    latestVitals: latestVitals
      ? {
          heartRate: latestVitals.heartRate,
          systolic: latestVitals.bloodPressureSystolic,
          diastolic: latestVitals.bloodPressureDiastolic,
          spo2: latestVitals.spo2,
          temperatureC: latestVitals.temperatureC,
          respiratoryRate: latestVitals.respiratoryRate,
          newsScore: latestVitals.newsScore,
        }
      : null,
    activeMedications: meds,
    abnormalLabs,
    openReferrals,
  };
}

async function collectLabFacts(patientId: string) {
  const orders = await db
    .select({ id: investigationOrders.id, panel: investigationOrders.panel, orderedAt: investigationOrders.orderedAt })
    .from(investigationOrders)
    .where(and(eq(investigationOrders.patientId, patientId), eq(investigationOrders.category, 'LAB')))
    .orderBy(desc(investigationOrders.orderedAt))
    .limit(10);

  const ids = orders.map((o) => o.id);
  const results = ids.length
    ? await db.select({
        orderId: investigationResults.orderId,
        analyte: investigationResults.analyte,
        value: investigationResults.value,
        unit: investigationResults.unit,
        flag: investigationResults.flag,
      }).from(investigationResults).where(inArray(investigationResults.orderId, ids))
    : [];

  return {
    panels: orders.map((o) => ({
      panel: o.panel,
      orderedAt: o.orderedAt.toISOString(),
      results: results.filter((r) => r.orderId === o.id).map(({ orderId: _o, ...rest }) => rest),
    })),
  };
}

async function collectRadiologyFacts(patientId: string) {
  const studies = await db
    .select({
      id: radiologyStudies.id,
      modality: radiologyStudies.modality,
      bodyPart: radiologyStudies.bodyPart,
      status: radiologyStudies.status,
    })
    .from(radiologyStudies)
    .where(eq(radiologyStudies.patientId, patientId))
    .orderBy(desc(radiologyStudies.requestedAt))
    .limit(10);

  const ids = studies.map((s) => s.id);
  const reports = ids.length
    ? await db.select({
        studyId: radiologyReports.studyId,
        impression: radiologyReports.impression,
        isCritical: radiologyReports.isCritical,
      }).from(radiologyReports).where(inArray(radiologyReports.studyId, ids))
    : [];

  return {
    studies: studies.map((s) => {
      const r = reports.find((x) => x.studyId === s.id);
      return { modality: s.modality, bodyPart: s.bodyPart, status: s.status, impression: r?.impression ?? null, isCritical: r?.isCritical ?? false };
    }),
  };
}

async function collectTimelineFacts(patientId: string, days: number) {
  const since = new Date(Date.now() - days * 86400_000);
  const events = await db
    .select({
      type: timelineEvents.eventType,
      title: timelineEvents.title,
      occurredAt: timelineEvents.occurredAt,
      severity: timelineEvents.severity,
    })
    .from(timelineEvents)
    .where(and(eq(timelineEvents.patientId, patientId), gte(timelineEvents.occurredAt, since)))
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(120);

  return {
    window: `the last ${days} day${days === 1 ? '' : 's'}`,
    events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
  };
}

/**
 * Generates and persists an advisory summary.
 * Never writes to a clinical table; the only side effects are an `ai_summaries`
 * row, a timeline marker and an audit entry.
 */
export async function generateSummary(
  user: AuthUser,
  input: { patientId: string; kind: AiKind; days?: number },
): Promise<{ id: string; content: string; keyPoints: string[]; provider: string; model: string | null; banner: string; createdAt: Date }> {
  await assertPatientAccess(user, input.patientId);

  const facts =
    input.kind === 'LAB_SUMMARY' ? await collectLabFacts(input.patientId)
    : input.kind === 'RADIOLOGY_SUMMARY' ? await collectRadiologyFacts(input.patientId)
    : input.kind === 'TIMELINE_SUMMARY' ? await collectTimelineFacts(input.patientId, input.days ?? 7)
    : await collectPatientFacts(input.patientId);

  const provider = getAiProvider();
  let result: AiResult;
  try {
    result = await provider.generate({ kind: input.kind, facts, instruction: INSTRUCTIONS[input.kind] });
  } catch (err) {
    console.error('[ai] hosted provider failed, falling back to offline summariser:', err);
    result = await new HeuristicAiProvider().generate({ kind: input.kind, facts, instruction: INSTRUCTIONS[input.kind] });
  }

  const inputDigest = createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32);

  const [row] = await db.insert(aiSummaries).values({
    patientId: input.patientId,
    kind: input.kind,
    content: result.content,
    keyPoints: result.keyPoints,
    provider: result.provider,
    model: result.model,
    inputDigest,
    requestedById: user.id,
  }).returning();

  await recordTimelineEvent({
    patientId: input.patientId,
    eventType: 'AI_SUMMARY',
    title: `${input.kind.replace(/_/g, ' ').toLowerCase()} generated`,
    description: AI_REVIEW_BANNER,
    actorId: user.id,
    referenceType: 'ai_summary',
    referenceId: row!.id,
  });

  await recordAudit({
    action: AUDIT.AI_SUMMARY_GENERATED,
    entityType: 'ai_summary',
    entityId: row!.id,
    patientId: input.patientId,
    actor: user,
    metadata: { kind: input.kind, provider: result.provider, model: result.model },
  });

  return {
    id: row!.id,
    content: result.content,
    keyPoints: result.keyPoints,
    provider: result.provider,
    model: result.model,
    banner: AI_REVIEW_BANNER,
    createdAt: row!.createdAt,
  };
}

export async function listSummaries(user: AuthUser, patientId: string) {
  await assertPatientAccess(user, patientId);
  return db
    .select({
      id: aiSummaries.id,
      kind: aiSummaries.kind,
      content: aiSummaries.content,
      keyPoints: aiSummaries.keyPoints,
      provider: aiSummaries.provider,
      model: aiSummaries.model,
      reviewed: aiSummaries.reviewed,
      createdAt: aiSummaries.createdAt,
      requestedByName: users.fullName,
    })
    .from(aiSummaries)
    .innerJoin(users, eq(users.id, aiSummaries.requestedById))
    .where(eq(aiSummaries.patientId, patientId))
    .orderBy(desc(aiSummaries.createdAt))
    .limit(20);
}

/** A clinician acknowledging that they have read and checked the output. */
export async function markSummaryReviewed(user: AuthUser, summaryId: string) {
  const [summary] = await db.select().from(aiSummaries).where(eq(aiSummaries.id, summaryId)).limit(1);
  if (!summary) throw new AppError('NOT_FOUND', 'Summary could not be found.');
  await assertPatientAccess(user, summary.patientId);

  const [row] = await db.update(aiSummaries)
    .set({ reviewed: true, reviewedById: user.id, reviewedAt: new Date() })
    .where(eq(aiSummaries.id, summaryId))
    .returning();
  return row!;
}

/** Shift handover across the caller's current caseload. */
export async function generateHandover(user: AuthUser) {
  const rows = await db
    .select({
      patientId: patients.id,
      name: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      bed: beds.code,
      status: patients.status,
      newsScore: sql<number | null>`(SELECT v.news_score FROM ${vitalSigns} v WHERE v.patient_id = patients.id ORDER BY v.recorded_at DESC LIMIT 1)`,
      abnormalLabs: sql<number>`(SELECT count(*)::int FROM ${investigationResults} r WHERE r.patient_id = patients.id AND r.flag <> 'NORMAL')`,
      openReferrals: sql<number>`(SELECT count(*)::int FROM ${referrals} rf WHERE rf.patient_id = patients.id AND rf.status IN ('PENDING','ACCEPTED','IN_PROGRESS'))`,
    })
    .from(patients)
    .innerJoin(admissions, and(eq(admissions.patientId, patients.id), eq(admissions.status, 'ADMITTED')))
    .leftJoin(beds, eq(beds.id, admissions.bedId))
    .where(sql`(
      ${admissions.attendingDoctorId} = ${user.id}
      OR EXISTS (SELECT 1 FROM ${careTeamMembers} c WHERE c.patient_id = patients.id AND c.user_id = ${user.id} AND c.removed_at IS NULL)
    )`)
    .limit(50);

  const hour = new Date().getHours();
  const shift = hour < 8 ? 'night shift' : hour < 16 ? 'day shift' : 'evening shift';

  const facts = {
    shift,
    patients: rows.map((r) => ({
      name: r.name,
      bed: r.bed,
      status: r.status,
      concerns: [
        r.newsScore != null && r.newsScore >= 3 ? `early-warning score ${r.newsScore}` : null,
        Number(r.abnormalLabs) > 0 ? `${r.abnormalLabs} abnormal laboratory value(s)` : null,
        Number(r.openReferrals) > 0 ? `${r.openReferrals} open referral(s)` : null,
      ].filter((x): x is string => !!x),
    })),
  };

  const result = await new HeuristicAiProvider().generate({
    kind: 'HANDOVER_SUMMARY',
    facts,
    instruction: INSTRUCTIONS.HANDOVER_SUMMARY,
  });

  return { ...result, banner: AI_REVIEW_BANNER, patientCount: rows.length };
}
