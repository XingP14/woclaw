/**
 * Anthropic provider stub.
 * Currently returns error — plug in your Anthropic API key via env var
 * ANTHROPIC_API_KEY to enable.
 *
 * Mythos-tier models (2026-06-09+):
 *   - `claude-fable-5`   — first public Mythos-class release (SWE-bench Pro 80.3%)
 *   - `claude-mythos-5`  — same base model; cyber/bio/chem auto-routed to Opus 4.8
 *
 * Free-tier cutoff: 2026-06-23. After that date, pay-as-you-go API key required.
 * Pricing (Fable5): $10 / 1M input + $50 / 1M output.
 * See hub/README.md "Supported Anthropic Models" for full table.
 */

import type {
  AIProvider,
  ImportanceResult,
  ExtractionResult,
  UsageHistoryEntry,
} from '../types.js';

export class AnthropicProvider implements AIProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  }

  async scoreMemory(
    _key: string,
    _content: string,
    _usageHistory: UsageHistoryEntry[],
  ): Promise<ImportanceResult> {
    if (!this.apiKey) {
      return {
        success: false,
        score: 5,
        reasoning: 'Anthropic provider not configured (ANTHROPIC_API_KEY not set)',
      };
    }
    return {
      success: false,
      score: 5,
      reasoning: 'Anthropic extraction not yet implemented',
    };
  }

  async extractSession(session: {
    id: string;
    transcript: string;
    summary?: string;
    tags?: string[];
  }): Promise<ExtractionResult> {
    void session;
    if (!this.apiKey) {
      return {
        success: false,
        summary: 'Anthropic provider not configured',
        tags: [],
      };
    }
    return {
      success: false,
      summary: 'Anthropic extraction not yet implemented',
      tags: [],
    };
  }
}
