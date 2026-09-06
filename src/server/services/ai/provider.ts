import '@/server/only';

/**
 * AI provider abstraction.
 *
 * The rest of the platform never talks to a model vendor directly. Swapping
 * `AI_PROVIDER` changes the implementation without touching a single caller,
 * and the default provider runs entirely offline so the product is functional
 * with no API key and no data leaving the deployment.
 *
 * Safety contract enforced by the callers of this module:
 *   - output is advisory and always rendered with a review banner;
 *   - the AI never writes to a clinical table, changes a medication, alters an
 *     order, or transitions a referral;
 *   - every generated summary is persisted in `ai_summaries` with the
 *     requesting user, so advice is attributable and reviewable.
 */

export type AiKind =
  | 'PATIENT_SUMMARY' | 'TIMELINE_SUMMARY' | 'LAB_SUMMARY'
  | 'RADIOLOGY_SUMMARY' | 'HANDOVER_SUMMARY' | 'REFERRAL_BRIEF';

export type AiRequest = {
  kind: AiKind;
  /** Structured, already-authorised clinical facts. Never raw table dumps. */
  facts: Record<string, unknown>;
  instruction: string;
};

export type AiResult = {
  content: string;
  keyPoints: string[];
  provider: string;
  model: string | null;
};

export interface AiProvider {
  readonly name: string;
  generate(request: AiRequest): Promise<AiResult>;
}

/** Shared guardrail text appended to every hosted-model prompt. */
export const AI_SYSTEM_PROMPT = [
  'You are a clinical documentation assistant inside a hospital platform.',
  'You summarise information that a clinician already has access to.',
  'You must not diagnose, prescribe, change medication, or state a plan as a decision.',
  'Write in neutral clinical language. Attribute every statement to the supplied data.',
  'If the data is insufficient, say so plainly rather than inferring.',
  'Never invent values, dates, names, or results.',
].join(' ');
