/**
 * OpenAI provider for extraction/scoring.
 * Uses GPT-4o-mini for scoring, GPT-4o for extraction.
 * Built-in rate limiting (500ms between calls).
 */

import type {
  AIProvider,
  ImportanceResult,
  ExtractionResult,
  UsageHistoryEntry,
} from '../types.js';

const SCORE_MODEL = 'gpt-4o-mini';
const EXTRACT_MODEL = 'gpt-4o';
const BASE_URL = 'https://api.openai.com/v1';
const RATE_LIMIT_MS = 500;

let lastCall = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCall;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastCall = Date.now();
}

async function openaiChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.3,
): Promise<string> {
  await rateLimit();

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? '';
}

export class OpenAIProvider implements AIProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!this.apiKey) {
      throw new Error('OpenAI API key not provided. Set OPENAI_API_KEY env var.');
    }
  }

  async scoreMemory(
    key: string,
    content: string,
    usageHistory: UsageHistoryEntry[],
  ): Promise<ImportanceResult> {
    const recent = usageHistory
      .slice(-10)
      .map((u) => `  - accessed at ${new Date(u.accessedAt).toISOString()}${u.query ? ` query="${u.query}"` : ''}`)
      .join('\n');

    const systemPrompt = `You are a memory importance scorer. Output ONLY a JSON object:
{"score": <number 0-10>, "reasoning": "<brief 1-sentence explanation>", "suggestedTags": ["tag1", "tag2"]}
Score guidelines:
  0-3: ephemeral, low-value (e.g. casual chat, typos)
  4-6: useful context for future sessions
  7-9: critical project/decision/relationship info
  10: irreplaceable, never forget`;

    const userPrompt = `Memory key: "${key}"
Memory content: """${content.slice(0, 2000)}"""
Recent usage history:
${recent || '(no usage recorded)'}`;

    try {
      const raw = await openaiChat(this.apiKey, SCORE_MODEL, systemPrompt, userPrompt, 0.2);
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned) as {
        score: number;
        reasoning?: string;
        suggestedTags?: string[];
      };
      return {
        success: true,
        score: Math.max(0, Math.min(10, parsed.score ?? 5)),
        reasoning: parsed.reasoning,
        suggestedTags: parsed.suggestedTags,
      };
    } catch (err) {
      return {
        success: false,
        score: 5,
        reasoning: `OpenAI scoring failed: ${(err as Error).message}`,
      };
    }
  }

  async extractSession(session: {
    id: string;
    transcript: string;
    summary?: string;
    tags?: string[];
  }): Promise<ExtractionResult> {
    const systemPrompt = `You are a session summarizer. Output ONLY a JSON object:
{"summary": "<2-3 sentence summary of the session>", "tags": ["tag1", "tag2", "tag3"], "keyEvents": ["event1", "event2"], "entities": ["entity1", "entity2"]}
Tags should be lowercase, 2-4 words max. Focus on topics, technologies, decisions, and actions taken.`;

    const userPrompt = `Session ID: ${session.id}
Existing summary (if any): ${session.summary ?? '(none)'}
Existing tags (if any): ${(session.tags ?? []).join(', ')}
Transcript excerpt: """${session.transcript.slice(0, 4000)}"""`;

    try {
      const raw = await openaiChat(this.apiKey, EXTRACT_MODEL, systemPrompt, userPrompt, 0.4);
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned) as {
        summary?: string;
        tags?: string[];
        keyEvents?: string[];
        entities?: string[];
      };
      return {
        success: true,
        summary: parsed.summary ?? '(no summary available)',
        tags: parsed.tags ?? [],
        keyEvents: parsed.keyEvents ?? [],
        entities: parsed.entities ?? [],
      };
    } catch (err) {
      return {
        success: false,
        summary: `Extraction failed: ${(err as Error).message}`,
        tags: session.tags ?? [],
      };
    }
  }
}
