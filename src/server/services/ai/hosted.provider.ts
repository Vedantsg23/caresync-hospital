import '@/server/only';
import { AI_SYSTEM_PROMPT, type AiProvider, type AiRequest, type AiResult } from './provider';

/**
 * Hosted-model adapter (Anthropic or OpenAI compatible).
 *
 * Only reached when AI_PROVIDER is set to a hosted vendor AND AI_API_KEY is
 * present. The key is read on the server; it is never exposed to the browser.
 * Any failure falls back to the offline provider at the call site rather than
 * breaking a clinical screen.
 */
export class HostedAiProvider implements AiProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(vendor: 'anthropic' | 'openai', apiKey: string, model?: string) {
    this.name = vendor;
    this.apiKey = apiKey;
    this.model = model || (vendor === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
  }

  async generate(request: AiRequest): Promise<AiResult> {
    const prompt = [
      request.instruction,
      '',
      'Structured clinical facts (JSON). Use only these; do not infer beyond them:',
      JSON.stringify(request.facts, null, 2),
      '',
      'Respond with 2-5 short paragraphs of plain prose, then a line "KEY POINTS:" followed by 3-5 bullet lines starting with "- ".',
    ].join('\n');

    const content = this.name === 'anthropic'
      ? await this.callAnthropic(prompt)
      : await this.callOpenAI(prompt);

    return { ...splitKeyPoints(content), provider: this.name, model: this.model };
  }

  private async callAnthropic(prompt: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? '';
  }
}

export function splitKeyPoints(text: string): { content: string; keyPoints: string[] } {
  const idx = text.toUpperCase().indexOf('KEY POINTS:');
  if (idx === -1) return { content: text.trim(), keyPoints: [] };
  const content = text.slice(0, idx).trim();
  const keyPoints = text.slice(idx + 'KEY POINTS:'.length)
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
  return { content, keyPoints };
}
