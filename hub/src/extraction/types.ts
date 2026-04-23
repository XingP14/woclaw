/**
 * AI Provider interface for the Extraction Engine.
 * Vendors implement this to plug in their own AI backend.
 */

export interface ImportanceResult {
  success: boolean;
  score: number;           // 0-10 importance score
  reasoning?: string;       // brief explanation
  suggestedTags?: string[]; // auto-tag suggestions
  metadata?: Record<string, unknown>;
}

export interface ExtractionResult {
  success: boolean;
  summary: string;         // concise session summary
  tags: string[];          // extracted topic tags
  keyEvents?: string[];    // notable events/actions
  entities?: string[];     // named entities mentioned
  metadata?: Record<string, unknown>;
}

export interface RerankedMemory {
  key: string;
  score: number;
  reason: string;
}

export interface UsageHistoryEntry {
  accessedAt: number;
  query?: string;
}

export interface ExtractionConfig {
  provider?: 'openai' | 'anthropic' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  mode?: 'sync' | 'batch';
  batchSize?: number;
  batchIntervalMs?: number;
}

export interface AIProvider {
  /**
   * Score a memory's importance given its content and usage history.
   */
  scoreMemory(
    key: string,
    content: string,
    usageHistory: UsageHistoryEntry[],
  ): Promise<ImportanceResult>;

  /**
   * Extract structured summary + tags from a session transcript.
   */
  extractSession(
    session: {
      id: string;
      transcript: string;
      summary?: string;
      tags?: string[];
    },
  ): Promise<ExtractionResult>;
}
