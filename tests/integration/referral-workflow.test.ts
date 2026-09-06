import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import {
  referrals, referralResponses, notifications, timelineEvents, auditLogs,
  clinicalNotes, careTeamMembers, patientAccessGrants, encounters,
} from '@/server/db/schema';
import {
  createReferral, acceptReferral, respondToReferral, completeReferral,
  getReferral, listReferrals, declineReferral, requestInformation, provideInformation,
} from '@/server/services/referral.service';
import { evaluatePatientAccess, assertPatientAccess } from '@/server/services/patient-access.service';
import { getPatientTimeline } from '@/server/services/timeline.service';
import { listNotifications, unreadCount } from '@/server/services/notification.service';
import { AppError } from '@/server/core/errors';
import { prepareDatabase, actorFor, patientByNumber, ACCOUNTS, DEMO_PATIENT } from './helpers';
import type { AuthUser } from '@/server/auth/context';

/**
 * THE ACCEPTANCE TEST.
 *
 * "A doctor can refer a patient to a specialist, the specialist receives the
 *  referral, sees the authorized patient context, accepts it, responds, and the
 *  referring doctor receives the response — with everything persisted in the
 *  database, reflected in the patient timeline, notified, and recorded in the
 *  audit trail."
 *
 * Every assertion below reads real rows back out of Postgres.
 */
describe('doctor to specialist referral, end to end', () => {
  let doctor: AuthUser;
  let specialist: AuthUser;
  let nurse: AuthUser;
  let patientId: string;
  let referralId: string;
  let referralNumber: string;

  beforeAll(async () => {
    prepareDatabase();
    doctor = await actorFor(ACCOUNTS.doctor);
    specialist = await actorFor(ACCOUNTS.specialist);
    nurse = await actorFor(ACCOUNTS.nurse);
    patientId = (await patientByNumber(DEMO_PATIENT)).id;
  });

  afterAll(async () => { await pool.end(); });

  it('step 1: the referring doctor has access to the patient', async () => {
    const decision = await evaluatePatientAccess(doctor, patientId);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ATTENDING_DOCTOR');
  });

  it('step 2: the doctor creates the referral, and it is persisted', async () => {
    const created = await createReferral(doctor, {
      patientId,
      specialistDoctorId: specialist.id,
      reason: 'Persistent chest pain and abnormal ECG',
      clinicalSummary:
        '52-year-old man three days after a myocardial infarction with ongoing central chest pain. ' +
        'Troponin I peaked at 780 ng/L and CT coronary angiography shows a 70 per cent proximal LAD stenosis.',
      symptoms: 'Central chest heaviness radiating to the left arm, worse on exertion.',
      relevantInvestigations: 'Troponin I 780 ng/L. Potassium 5.4 mmol/L.',
      currentMedications: 'Aspirin 75 mg once daily, Bisoprolol 2.5 mg once daily.',
      priority: 'URGENT',
    });

    referralId = created.id;
    referralNumber = created.referralNumber;

    const [row] = await db.select().from(referrals).where(eq(referrals.id, referralId)).limit(1);
    expect(row).toBeDefined();
    expect(row!.status).toBe('PENDING');
    expect(row!.priority).toBe('URGENT');
    expect(row!.referringDoctorId).toBe(doctor.id);
    expect(row!.specialistDoctorId).toBe(specialist.id);
    expect(row!.referralNumber).toMatch(/^REF-\d{4}-\d{5}$/);
    // The referral is attached to the patient's open admission.
    expect(row!.admissionId).not.toBeNull();
  });

  it('step 2a: the patient timeline records the referral', async () => {
    const timeline = await getPatientTimeline({ patientId, limit: 10 });
    const event = timeline.items.find(
      (e) => e.eventType === 'REFERRAL_CREATED' && e.referenceId === referralId,
    );
    expect(event, 'a REFERRAL_CREATED timeline event must exist').toBeDefined();
    expect(event!.actor?.id).toBe(doctor.id);
    expect(event!.severity).toBe('ATTENTION'); // urgent
  });

  it('step 2b: the specialist is notified', async () => {
    const { items } = await listNotifications({ userId: specialist.id, unreadOnly: true, limit: 50 });
    const notification = items.find((n) => n.referenceId === referralId);
    expect(notification, 'the specialist must receive a notification').toBeDefined();
    expect(notification!.type).toBe('REFERRAL_CREATED');
    expect(notification!.message).toContain('Rahul Mehta');
    expect(notification!.link).toBe(`/referrals/${referralId}`);
    expect(await unreadCount(specialist.id)).toBeGreaterThan(0);
  });

  it('step 2c: the creation is written to the audit trail', async () => {
    const [entry] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.action, 'REFERRAL_CREATED'), eq(auditLogs.entityId, referralId)))
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry!.userId).toBe(doctor.id);
    expect(entry!.patientId).toBe(patientId);
    expect(entry!.outcome).toBe('SUCCESS');
  });

  it('step 3: the referral appears in the specialist inbox', async () => {
    const inbox = await listReferrals(specialist, { box: 'incoming', status: ['PENDING'] });
    const found = inbox.find((r) => r.id === referralId);
    expect(found, 'the referral must appear on the specialist inbox').toBeDefined();
    expect(found!.patientFirstName).toBe('Rahul');
    expect(found!.referringDoctorName).toBe(doctor.fullName);
  });

  it('step 4: the specialist can read the authorised patient context', async () => {
    const detail = await getReferral(specialist, referralId);
    expect(detail.clinicalSummary).toContain('Troponin');
    expect(detail.currentMedications).toContain('Aspirin');
    expect(detail.patientAllergies).toContain('Penicillin');
    expect(detail.responses).toEqual([]);
  });

  it('step 5: accepting the referral grants the specialist access to the record', async () => {
    // Before accepting, this specialist's access comes only from being a referral party.
    const before = await evaluatePatientAccess(specialist, patientId);
    expect(before.allowed).toBe(true);
    expect(before.reason).toBe('REFERRAL_PARTY');

    const updated = await acceptReferral(specialist, referralId);
    expect(updated.status).toBe('ACCEPTED');
    expect(updated.acceptedAt).not.toBeNull();

    const [grant] = await db.select().from(patientAccessGrants)
      .where(and(
        eq(patientAccessGrants.patientId, patientId),
        eq(patientAccessGrants.userId, specialist.id),
        eq(patientAccessGrants.referenceId, referralId),
      )).limit(1);
    expect(grant, 'accepting must create an explicit, auditable access grant').toBeDefined();
    expect(grant!.reason).toBe('REFERRAL');
    expect(grant!.grantedById).toBe(doctor.id);

    const [team] = await db.select().from(careTeamMembers)
      .where(and(
        eq(careTeamMembers.patientId, patientId),
        eq(careTeamMembers.userId, specialist.id),
        eq(careTeamMembers.role, 'SPECIALIST'),
      )).limit(1);
    expect(team, 'the specialist joins the care team').toBeDefined();

    const [encounter] = await db.select().from(encounters)
      .where(and(
        eq(encounters.patientId, patientId),
        eq(encounters.providerId, specialist.id),
        eq(encounters.encounterType, 'SPECIALIST_CONSULTATION'),
      )).limit(1);
    expect(encounter, 'a specialist consultation encounter is opened').toBeDefined();
    expect(encounter!.status).toBe('IN_PROGRESS');
  });

  it('step 5a: the referring doctor is notified of the acceptance', async () => {
    const { items } = await listNotifications({ userId: doctor.id, limit: 50 });
    const notification = items.find(
      (n) => n.referenceId === referralId && n.type === 'REFERRAL_ACCEPTED',
    );
    expect(notification, 'the referring doctor must be notified').toBeDefined();
    expect(notification!.message).toContain(specialist.fullName);
  });

  it('step 6: a referral cannot be completed before a response is recorded', async () => {
    await expect(completeReferral(specialist, referralId)).rejects.toThrow(AppError);
    const [row] = await db.select().from(referrals).where(eq(referrals.id, referralId)).limit(1);
    expect(row!.status).toBe('ACCEPTED');
  });

  it('step 7: the specialist records their response', async () => {
    const response = await respondToReferral(specialist, referralId, {
      assessment: 'Significant proximal LAD stenosis on a background of recent myocardial infarction.',
      findings: 'Ongoing exertional chest pain. Blood pressure labile. Potassium mildly elevated at 5.4 mmol/L.',
      recommendations: 'Proceed to invasive coronary angiography with a view to percutaneous intervention.',
      treatmentPlan: 'Continue dual antiplatelet therapy. Hold the ACE inhibitor until potassium normalises.',
      followUp: 'Cardiology review after angiography. Repeat electrolytes in 24 hours.',
    });

    expect(response.id).toBeTruthy();
    expect(response.isFinal).toBe(false);

    const [row] = await db.select().from(referrals).where(eq(referrals.id, referralId)).limit(1);
    expect(row!.status).toBe('IN_PROGRESS');
    expect(row!.respondedAt).not.toBeNull();
  });

  it('step 7a: the response is also written to the chart as a specialist note', async () => {
    const notes = await db.select().from(clinicalNotes)
      .where(and(eq(clinicalNotes.patientId, patientId), eq(clinicalNotes.noteType, 'SPECIALIST')))
      .orderBy(desc(clinicalNotes.createdAt));

    const note = notes.find((n) => n.title.includes(referralNumber));
    expect(note, 'the specialist response must appear on the chart, not only inside the referral').toBeDefined();
    expect(note!.authorId).toBe(specialist.id);
    expect(note!.content).toContain('ASSESSMENT');
    expect(note!.content).toContain('TREATMENT PLAN');
    expect(note!.version).toBe(1);
  });

  it('step 7b: the referring doctor is notified of the response', async () => {
    const { items } = await listNotifications({ userId: doctor.id, limit: 50 });
    const notification = items.find(
      (n) => n.referenceId === referralId && n.type === 'REFERRAL_RESPONSE',
    );
    expect(notification, 'the referring doctor must be notified of the response').toBeDefined();
  });

  it('step 8: the specialist completes the referral', async () => {
    const completed = await completeReferral(specialist, referralId);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();

    const responses = await db.select().from(referralResponses)
      .where(eq(referralResponses.referralId, referralId));
    expect(responses.every((r) => r.isFinal), 'responses are marked final on completion').toBe(true);

    const [encounter] = await db.select().from(encounters)
      .where(and(
        eq(encounters.patientId, patientId),
        eq(encounters.providerId, specialist.id),
        eq(encounters.encounterType, 'SPECIALIST_CONSULTATION'),
      )).orderBy(desc(encounters.startTime)).limit(1);
    expect(encounter!.status).toBe('COMPLETED');
    expect(encounter!.endTime).not.toBeNull();
  });

  it('step 9: the referring doctor sees the completed response', async () => {
    const detail = await getReferral(doctor, referralId);
    expect(detail.status).toBe('COMPLETED');
    expect(detail.responses).toHaveLength(1);
    expect(detail.responses[0]!.assessment).toContain('LAD stenosis');
    expect(detail.responses[0]!.treatmentPlan).toContain('antiplatelet');
    expect(detail.responses[0]!.isFinal).toBe(true);
    expect(detail.responses[0]!.authorName).toBe(specialist.fullName);
  });

  it('step 9a: the referring doctor is notified of completion', async () => {
    const { items } = await listNotifications({ userId: doctor.id, limit: 50 });
    const notification = items.find(
      (n) => n.referenceId === referralId && n.type === 'REFERRAL_COMPLETED',
    );
    expect(notification).toBeDefined();
  });

  it('step 10: the timeline carries the whole journey in order', async () => {
    const timeline = await getPatientTimeline({ patientId, limit: 100 });
    const forThisReferral = timeline.items
      .filter((e) => e.referenceId === referralId)
      .map((e) => e.eventType);

    for (const expected of [
      'REFERRAL_CREATED', 'REFERRAL_ACCEPTED', 'REFERRAL_RESPONSE', 'REFERRAL_COMPLETED',
    ]) {
      expect(forThisReferral, `timeline must contain ${expected}`).toContain(expected);
    }

    // Newest first, so the completion is ahead of the creation.
    expect(forThisReferral.indexOf('REFERRAL_COMPLETED'))
      .toBeLessThan(forThisReferral.indexOf('REFERRAL_CREATED'));
  });

  it('step 11: every transition is in the audit trail', async () => {
    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, referralId));
    const actions = entries.map((e) => e.action);
    for (const expected of ['REFERRAL_CREATED', 'REFERRAL_ACCEPTED', 'REFERRAL_COMPLETED']) {
      expect(actions, `audit must contain ${expected}`).toContain(expected);
    }

    const responded = await db.select().from(auditLogs)
      .where(eq(auditLogs.action, 'REFERRAL_RESPONDED'));
    expect(responded.length).toBeGreaterThan(0);

    const granted = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.action, 'ACCESS_GRANTED'), eq(auditLogs.entityId, referralId)));
    expect(granted.length, 'granting patient access is itself audited').toBeGreaterThan(0);
  });

  it('step 12: the completed referral is terminal', async () => {
    await expect(acceptReferral(specialist, referralId)).rejects.toThrow(AppError);
    await expect(declineReferral(specialist, referralId, 'changed my mind')).rejects.toThrow(AppError);

    const [row] = await db.select().from(referrals).where(eq(referrals.id, referralId)).limit(1);
    expect(row!.status).toBe('COMPLETED');
  });

  it('enforces that only the addressed specialist can act on a referral', async () => {
    const fresh = await createReferral(doctor, {
      patientId,
      specialistDoctorId: specialist.id,
      reason: 'Second opinion on anticoagulation',
      clinicalSummary: 'Query on anticoagulation strategy given renal impairment.',
    });

    // The nurse is on this patient's care team but is not the addressed specialist.
    await expect(acceptReferral(nurse, fresh.id)).rejects.toThrow(AppError);
    // The referring doctor cannot accept their own referral either.
    await expect(acceptReferral(doctor, fresh.id)).rejects.toThrow(AppError);

    const [row] = await db.select().from(referrals).where(eq(referrals.id, fresh.id)).limit(1);
    expect(row!.status).toBe('PENDING');
  });

  it('refuses a referral addressed to yourself', async () => {
    await expect(createReferral(doctor, {
      patientId,
      specialistDoctorId: doctor.id,
      reason: 'Self referral',
      clinicalSummary: 'Should not be possible.',
    })).rejects.toThrow(AppError);
  });

  it('supports the request-information round trip', async () => {
    const created = await createReferral(doctor, {
      patientId,
      specialistDoctorId: specialist.id,
      reason: 'Rhythm assessment',
      clinicalSummary: 'Intermittent palpitations, telemetry inconclusive.',
    });

    await requestInformation(specialist, created.id, 'Has a 24-hour tape been arranged?');
    let [row] = await db.select().from(referrals).where(eq(referrals.id, created.id)).limit(1);
    expect(row!.status).toBe('REQUESTED_INFORMATION');
    expect(row!.informationRequest).toContain('24-hour tape');

    // Only the referring doctor may answer.
    await expect(provideInformation(specialist, created.id, 'yes')).rejects.toThrow(AppError);

    await provideInformation(doctor, created.id, 'Yes, the tape is booked for tomorrow morning.');
    [row] = await db.select().from(referrals).where(eq(referrals.id, created.id)).limit(1);
    expect(row!.status).toBe('PENDING');
    expect(row!.informationResponse).toContain('booked');

    // And it can then proceed normally.
    const accepted = await acceptReferral(specialist, created.id);
    expect(accepted.status).toBe('ACCEPTED');
  });

  it('records a decline with its reason and notifies the referrer', async () => {
    const created = await createReferral(doctor, {
      patientId,
      specialistDoctorId: specialist.id,
      reason: 'Routine review',
      clinicalSummary: 'Stable patient, routine question.',
    });

    const declined = await declineReferral(specialist, created.id, 'Better suited to the outpatient clinic.');
    expect(declined.status).toBe('DECLINED');
    expect(declined.declineReason).toContain('outpatient');

    const { items } = await listNotifications({ userId: doctor.id, limit: 50 });
    expect(items.some((n) => n.referenceId === created.id && n.type === 'REFERRAL_DECLINED')).toBe(true);

    const events = await db.select().from(timelineEvents)
      .where(and(eq(timelineEvents.referenceId, created.id), eq(timelineEvents.eventType, 'REFERRAL_DECLINED')));
    expect(events.length).toBe(1);
  });

  it('keeps a referral out of an unrelated clinician’s inbox', async () => {
    const radiologist = await actorFor(ACCOUNTS.radiology);
    const inbox = await listReferrals(radiologist, { box: 'all' });
    expect(inbox.some((r) => r.id === referralId)).toBe(false);
    await expect(getReferral(radiologist, referralId)).rejects.toThrow(AppError);
  });

  it('still allows the referring doctor to reach the patient after completion', async () => {
    await expect(assertPatientAccess(doctor, patientId)).resolves.toBeUndefined();
    await expect(assertPatientAccess(specialist, patientId)).resolves.toBeUndefined();
  });
});
