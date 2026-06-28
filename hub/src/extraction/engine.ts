/**
 * ExtractionEngine — orchestrates AI-powered memory scoring, session
 * extraction, and memory reranking.
 *
 * Coordinates between the AI provider (OpenAI/Anthropic/Ollama) and the
 * DB layer to score, summarize, and rank memories.
 */

import type { AIProvider, ExtractionConfig } from './types.js';
import type { ImportanceResult, ExtractionResult, RerankedMemory } from './types.js';
import type { GraphStore } from '../graph/store.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAIProvider } from './providers/openai.js';

function loadProvider(provider: NonNullable<ExtractionConfig['provider']>, config: ExtractionConfig): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey);
    case 'ollama':
      return new OllamaProvider(config.baseUrl);
    case 'openai':
    default:
      return new OpenAIProvider(config.apiKey);
  }
}

export function createExtractionProvider(config: ExtractionConfig = {}): AIProvider {
  const provider = config.provider ?? 'openai';
  return loadProvider(provider, config);
}

export function createExtractionEngine(config: ExtractionConfig = {}): ExtractionEngine {
  return new ExtractionEngine(createExtractionProvider(config), config);
}

export class ExtractionEngine {
  private batchSize: number;
  private batchIntervalMs: number;
  private graphStore: GraphStore | null = null;

  constructor(
    private provider: AIProvider,
    config: Partial<ExtractionConfig> = {},
  ) {
    this.batchSize = Math.max(1, config.batchSize ?? 10);
    this.batchIntervalMs = Math.max(0, config.batchIntervalMs ?? 1000);
  }

  async scoreMemory(
    key: string,
    content: string,
    usageHistory: Array<{ accessedAt: number; query?: string }>,
  ): Promise<ImportanceResult> {
    return this.provider.scoreMemory(key, content, usageHistory);
  }

  async extractSession(session: {
    id: string;
    transcript: string;
    summary?: string;
    tags?: string[];
    agentId?: string;
  }): Promise<ExtractionResult> {
    const result = await this.provider.extractSession(session);
    const agentId = session.agentId ?? 'extraction-engine';
    this.syncMemoryNodes(session, result, agentId);
    return result;
  }

  setGraphStore(graphStore: GraphStore | null): void {
    this.graphStore = graphStore;
  }

  private syncMemoryNodes(session: { id: string; transcript: string; agentId?: string }, result: ExtractionResult, agentId: string): void {
    if (!this.graphStore) return;

    const tags = result.tags ?? [];
    const createdKeys = new Set<string>();
    const addMemory = (suffix: string, value: string, extraTags: string[] = []) => {
      const key = `session:${session.id}:${suffix}`;
      if (createdKeys.has(key)) return;
      createdKeys.add(key);
      this.graphStore!.syncMemoryNode(key, value, agentId, extraTags);
    };

    addMemory('summary', result.summary, tags);
    for (const topic of tags) {
      addMemory(`topic:${topic}`, topic, [`topic:${topic}`]);
    }
    for (const fact of result.keyEvents ?? []) {
      addMemory(`fact:${fact.slice(0, 24)}`, fact, tags);
    }
    for (const entity of result.entities ?? []) {
      addMemory(`entity:${entity}`, entity, tags);
    }
  }

  async processBatch<T>(queue: T[], worker: (item: T) => Promise<void>): Promise<number> {
    let processed = 0;
    for (let i = 0; i < queue.length && processed < this.batchSize; i++) {
      if (processed > 0 && this.batchIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.batchIntervalMs));
      }
      await worker(queue[i]);
      processed++;
    }
    return processed;
  }

  rankMemories(rankLists: Array<Array<{ key: string; rank: number }>>, topK = 10): RerankedMemory[] {
    const scores = new Map<string, number>();
    for (const list of rankLists) {
      for (let i = 0; i < list.length; i++) {
        const { key, rank } = list[i];
        const rrf = 1 / (60 + i + 1);
        const current = scores.get(key) ?? 0;
        scores.set(key, current + rrf * (rank > 0 ? rank : 1));
      }
    }
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([key, score]) => ({ key, score: Math.round(score * 1000) / 1000, reason: '' }));
  }
}
