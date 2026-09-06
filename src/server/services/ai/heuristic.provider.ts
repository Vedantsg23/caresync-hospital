import '@/server/only';
import type { AiProvider, AiRequest, AiResult } from './provider';

type Facts = Record<string, unknown>;

const str = (f: Facts, k: string) => (typeof f[k] === 'string' ? (f[k] as string) : null);
const num = (f: Facts, k: string) => (typeof f[k] === 'number' ? (f[k] as number) : null);
const arr = <T = unknown>(f: Facts, k: string): T[] => (Array.isArray(f[k]) ? (f[k] as T[]) : []);

/**
 * Deterministic, offline summariser.
 *
 * This is not a language model: it composes prose from the structured facts the
 * caller already assembled and authorised. That makes it reproducible,
 * auditable, free, and incapable of hallucinating a value that is not in the
 * record - which is the right default for a clinical tool. Point AI_PROVIDER at
 * a hosted model when you want richer narrative.
 */
export class HeuristicAiProvider implements AiProvider {
  readonly name = 'heuristic';

  async generate(request: AiRequest): Promise<AiResult> {
    const f = request.facts as Facts;
    switch (request.kind) {
      case 'PATIENT_SUMMARY': return this.patientSummary(f);
      case 'LAB_SUMMARY': return this.labSummary(f);
      case 'RADIOLOGY_SUMMARY': return this.radiologySummary(f);
      case 'HANDOVER_SUMMARY': return this.handoverSummary(f);
      case 'REFERRAL_BRIEF': return this.referralBrief(f);
      case 'TIMELINE_SUMMARY':
      default: return this.timelineSummary(f);
    }
  }

  private wrap(paragraphs: string[], keyPoints: string[]): AiResult {
    return {
      content: paragraphs.filter(Boolean).join('\n\n'),
      keyPoints: keyPoints.filter(Boolean),
      provider: this.name,
      model: null,
    };
  }

  private patientSummary(f: Facts): AiResult {
    const name = str(f, 'name') ?? 'The patient';
    const age = num(f, 'age');
    const gender = str(f, 'gender');
    const status = str(f, 'status') ?? 'STABLE';
    const ward = str(f, 'ward');
    const bed = str(f, 'bed');
    const attending = str(f, 'attendingDoctor');
    const reason = str(f, 'admissionReason');
    const los = num(f, 'lengthOfStayDays');
    const allergies = arr<string>(f, 'allergies');
    const conditions = arr<string>(f, 'chronicConditions');
    const meds = arr<{ name: string; dose: string; frequency: string }>(f, 'activeMedications');
    const vitals = f.latestVitals as Record<string, number | null> | null;
    const abnormalLabs = arr<{ analyte: string; value: string; flag: string }>(f, 'abnormalLabs');
    const openReferrals = arr<{ specialist: string; status: string; reason: string }>(f, 'openReferrals');

    const identity = [
      `${name}`,
      age != null ? `${age}-year-old` : null,
      gender && gender !== 'UNKNOWN' ? gender.toLowerCase() : null,
    ].filter(Boolean);

    const p1 = [
      `${identity[0]} is a ${identity.slice(1).join(' ') || 'patient'} currently recorded as ${status.replace('_', ' ').toLowerCase()}.`,
      reason ? `Admitted for ${reason.toLowerCase()}.` : null,
      ward ? `Located in ${ward}${bed ? `, bed ${bed}` : ''}.` : null,
      attending ? `Attending clinician is ${attending}.` : null,
      los != null ? `Length of stay to date is ${los} day${los === 1 ? '' : 's'}.` : null,
    ].filter(Boolean).join(' ');

    const p2 = [
      allergies.length
        ? `Recorded allergies: ${allergies.join(', ')}.`
        : 'No allergies are recorded.',
      conditions.length ? `Background conditions: ${conditions.join(', ')}.` : null,
    ].filter(Boolean).join(' ');

    const p3 = vitals
      ? `Most recent observation set: ${[
          vitals.systolic && vitals.diastolic ? `BP ${vitals.systolic}/${vitals.diastolic} mmHg` : null,
          vitals.heartRate ? `HR ${vitals.heartRate} bpm` : null,
          vitals.spo2 ? `SpO2 ${vitals.spo2}%` : null,
          vitals.temperatureC ? `temperature ${vitals.temperatureC} C` : null,
          vitals.respiratoryRate ? `RR ${vitals.respiratoryRate}` : null,
        ].filter(Boolean).join(', ')}${vitals.newsScore != null ? ` (aggregate early-warning score ${vitals.newsScore})` : ''}.`
      : 'No observations have been recorded for this admission yet.';

    const p4 = meds.length
      ? `Active medication: ${meds.map((m) => `${m.name} ${m.dose} ${m.frequency}`).join('; ')}.`
      : 'No active medication is recorded.';

    const p5 = abnormalLabs.length
      ? `Laboratory values outside the reference range: ${abnormalLabs.map((l) => `${l.analyte} ${l.value} (${l.flag.replace('_', ' ').toLowerCase()})`).join(', ')}.`
      : 'All reported laboratory values are within their reference ranges.';

    const p6 = openReferrals.length
      ? `Open specialist involvement: ${openReferrals.map((r) => `${r.specialist} (${r.status.replace('_', ' ').toLowerCase()}) for ${r.reason.toLowerCase()}`).join('; ')}.`
      : null;

    const keyPoints = [
      status !== 'STABLE' ? `Status is ${status.replace('_', ' ').toLowerCase()} - review advised` : 'Status stable',
      allergies.length ? `Allergies: ${allergies.join(', ')}` : 'No known allergies',
      abnormalLabs.length ? `${abnormalLabs.length} abnormal laboratory value(s)` : 'Laboratory values within range',
      meds.length ? `${meds.length} active medication order(s)` : 'No active medication',
      openReferrals.length ? `${openReferrals.length} open referral(s)` : '',
    ];

    return this.wrap([p1, p2, p3, p4, p5, p6].filter((x): x is string => !!x), keyPoints);
  }

  private labSummary(f: Facts): AiResult {
    const panels = arr<{ panel: string; orderedAt: string; results: { analyte: string; value: string; unit: string | null; flag: string }[] }>(f, 'panels');
    if (!panels.length) {
      return this.wrap(['No laboratory results are available for this patient.'], ['No laboratory data']);
    }
    const abnormal = panels.flatMap((p) => p.results.filter((r) => r.flag !== 'NORMAL').map((r) => ({ ...r, panel: p.panel })));
    const critical = abnormal.filter((r) => r.flag.startsWith('CRITICAL'));

    const p1 = `${panels.length} laboratory panel${panels.length === 1 ? '' : 's'} reported, containing ${panels.reduce((n, p) => n + p.results.length, 0)} individual values.`;
    const p2 = critical.length
      ? `${critical.length} value${critical.length === 1 ? ' is' : 's are'} in the critical range and require immediate clinical review: ${critical.map((c) => `${c.analyte} ${c.value}${c.unit ? ' ' + c.unit : ''}`).join(', ')}.`
      : abnormal.length
        ? `${abnormal.length} value${abnormal.length === 1 ? ' is' : 's are'} outside the reference range: ${abnormal.map((c) => `${c.analyte} ${c.value}${c.unit ? ' ' + c.unit : ''} (${c.flag.toLowerCase()})`).join(', ')}.`
        : 'All reported values fall within their reference ranges.';
    const p3 = `Panels reported: ${panels.map((p) => p.panel).join(', ')}.`;

    return this.wrap([p1, p2, p3], [
      critical.length ? `${critical.length} critical value(s)` : '',
      `${abnormal.length} abnormal value(s)`,
      `${panels.length} panel(s) reported`,
    ]);
  }

  private radiologySummary(f: Facts): AiResult {
    const studies = arr<{ modality: string; bodyPart: string; status: string; impression: string | null; isCritical: boolean }>(f, 'studies');
    if (!studies.length) {
      return this.wrap(['No imaging studies are recorded for this patient.'], ['No imaging data']);
    }
    const reported = studies.filter((s) => s.impression);
    const pending = studies.filter((s) => !s.impression);
    const critical = studies.filter((s) => s.isCritical);

    const p1 = `${studies.length} imaging stud${studies.length === 1 ? 'y' : 'ies'} on record: ${studies.map((s) => `${s.modality} ${s.bodyPart}`).join(', ')}.`;
    const p2 = reported.length
      ? `Reported impressions: ${reported.map((s) => `${s.modality} ${s.bodyPart} - ${s.impression}`).join(' | ')}`
      : 'No study has been reported yet.';
    const p3 = pending.length ? `${pending.length} stud${pending.length === 1 ? 'y is' : 'ies are'} awaiting a report.` : null;
    const p4 = critical.length ? `${critical.length} report is flagged as a critical finding.` : null;

    return this.wrap([p1, p2, p3, p4].filter((x): x is string => !!x), [
      critical.length ? 'Critical imaging finding present' : '',
      `${reported.length} reported, ${pending.length} pending`,
    ]);
  }

  private handoverSummary(f: Facts): AiResult {
    const patients = arr<{ name: string; bed: string | null; status: string; concerns: string[] }>(f, 'patients');
    const shift = str(f, 'shift') ?? 'current shift';
    if (!patients.length) {
      return this.wrap([`No patients are currently assigned for the ${shift}.`], ['No assigned patients']);
    }
    const escalate = patients.filter((p) => p.status !== 'STABLE');

    const p1 = `${patients.length} patient${patients.length === 1 ? '' : 's'} to hand over for the ${shift}. ${escalate.length} require${escalate.length === 1 ? 's' : ''} active attention.`;
    const p2 = patients.map((p) =>
      `${p.bed ? `[${p.bed}] ` : ''}${p.name} - ${p.status.replace('_', ' ').toLowerCase()}${p.concerns.length ? `: ${p.concerns.join('; ')}` : '; no outstanding concerns recorded'}.`,
    ).join('\n');

    return this.wrap([p1, p2], [
      `${patients.length} patient(s) on handover`,
      escalate.length ? `${escalate.length} needing attention` : 'All patients stable',
    ]);
  }

  private referralBrief(f: Facts): AiResult {
    const patient = str(f, 'patientName') ?? 'The patient';
    const reason = str(f, 'reason') ?? 'unspecified reason';
    const priority = str(f, 'priority') ?? 'ROUTINE';
    const summary = str(f, 'clinicalSummary') ?? '';
    const symptoms = str(f, 'symptoms');
    const history = str(f, 'relevantHistory');
    const investigations = str(f, 'relevantInvestigations');
    const meds = str(f, 'currentMedications');
    const referrer = str(f, 'referringDoctor') ?? 'the referring clinician';

    const p1 = `${referrer} has referred ${patient} on a ${priority.toLowerCase()} basis for ${reason.toLowerCase()}.`;
    const p2 = summary ? `Clinical summary as supplied: ${summary}` : null;
    const p3 = [
      symptoms ? `Presenting symptoms: ${symptoms}` : null,
      history ? `Relevant history: ${history}` : null,
      investigations ? `Investigations to date: ${investigations}` : null,
      meds ? `Current medication: ${meds}` : null,
    ].filter(Boolean).join('\n');

    return this.wrap([p1, p2, p3].filter((x): x is string => !!x), [
      `Priority: ${priority.toLowerCase()}`,
      `Reason: ${reason}`,
      symptoms ? 'Symptoms documented' : 'No symptoms documented',
    ]);
  }

  private timelineSummary(f: Facts): AiResult {
    const events = arr<{ type: string; title: string; occurredAt: string; severity: string }>(f, 'events');
    const window = str(f, 'window') ?? 'the recorded period';
    if (!events.length) {
      return this.wrap([`No events are recorded for ${window}.`], ['No recorded activity']);
    }

    const byType = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    const escalations = events.filter((e) => e.severity !== 'INFO');

    const label = (t: string) => t.replace(/_/g, ' ').toLowerCase();
    const p1 = `${events.length} event${events.length === 1 ? '' : 's'} recorded during ${window}.`;
    const p2 = `Activity breakdown: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${label(t)}`).join(', ')}.`;
    const p3 = escalations.length
      ? `${escalations.length} event${escalations.length === 1 ? '' : 's'} were flagged for attention: ${escalations.slice(0, 6).map((e) => e.title).join('; ')}.`
      : 'No event during this period was flagged for attention.';

    return this.wrap([p1, p2, p3], [
      `${events.length} recorded event(s)`,
      escalations.length ? `${escalations.length} flagged for attention` : 'Nothing flagged',
    ]);
  }
}
