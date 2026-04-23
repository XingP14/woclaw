/**
 * Ollama provider for extraction/scoring.
 * Uses a local Ollama instance via the chat/completions API shape.
 * Enable by setting OLLAMA_BASE_URL (default http://localhost:11434).
 */

import type {
  AIProvider,
  ImportanceResult,
  ExtractionResult,
  UsageHistoryEntry,
} from '../types.js';

const SCORE_MODEL = 'llama3.1';
const EXTRACT_MODEL = 'llama3.1';

async function ollamaChat(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as {
    message?: { content?: string };
    response?: string;
  };
  return json.message?.content ?? json.response ?? '';
}

export class OllamaProvider implements AIProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
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
{"score": <number 0-10>, "reasoning": "<brief 1-sentence explanation>", "suggestedTags": ["tag1", "tag2"]}`;
    const userPrompt = `Memory key: "${key}"\nMemory content: """${content.slice(0, 2000)}"""\nRecent usage history:\n${recent || '(no usage recorded)'}`;

    try {
      const raw = await ollamaChat(this.baseUrl, SCORE_MODEL, systemPrompt, userPrompt);
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned) as { score?: number; reasoning?: string; suggestedTags?: string[] };
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
        reasoning: `Ollama scoring failed: ${(err as Error).message}`,
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
{"summary": "<2-3 sentence summary of the session>", "tags": ["tag1", "tag2", "tag3"], "keyEvents": ["event1", "event2"], "entities": ["entity1", "entity2"]}`;
    const userPrompt = `Session ID: ${session.id}\nExisting summary (if any): ${session.summary ?? '(none)'}\nExisting tags (if any): ${(session.tags ?? []).join(', ')}\nTranscript excerpt: """${session.transcript.slice(0, 4000)}"""`;

    try {
      const raw = await ollamaChat(this.baseUrl, EXTRACT_MODEL, systemPrompt, userPrompt);
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
