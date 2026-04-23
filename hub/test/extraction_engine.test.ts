/**
 * Unit tests for ExtractionEngine.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExtractionEngine } from '../src/extraction/engine.js';
import type { AIProvider } from '../src/types.js';

function createMockProvider(): AIProvider {
  return {
    scoreMemory: vi.fn(async (key, content, usageHistory) => ({
      success: true,
      score: 8,
      reasoning: `mocked:${key}:${content.length}:${usageHistory.length}`,
      suggestedTags: ['mock', 'test'],
    })),
    extractSession: vi.fn(async (session) => ({
      success: true,
      summary: `summary:${session.id}`,
      tags: ['alpha', 'beta'],
      keyEvents: ['event-1'],
      entities: ['entity-1'],
    })),
  };
}

describe('ExtractionEngine', () => {
  it('delegates scoreMemory to provider', async () => {
    const provider = createMockProvider();
    const engine = new ExtractionEngine(provider, {});

    const result = await engine.scoreMemory('k1', 'hello world', [{ accessedAt: 123, query: 'hello' }]);

    expect(provider.scoreMemory).toHaveBeenCalledOnce();
    expect(provider.scoreMemory).toHaveBeenCalledWith('k1', 'hello world', [{ accessedAt: 123, query: 'hello' }]);
    expect(result.success).toBe(true);
    expect(result.score).toBe(8);
  });

  it('delegates extractSession to provider', async () => {
    const provider = createMockProvider();
    const engine = new ExtractionEngine(provider, {});

    const result = await engine.extractSession({
      id: 'sess-1',
      transcript: 'turn 1',
      summary: 'old summary',
      tags: ['old'],
    });

    expect(provider.extractSession).toHaveBeenCalledOnce();
    expect(provider.extractSession).toHaveBeenCalledWith({
      id: 'sess-1',
      transcript: 'turn 1',
      summary: 'old summary',
      tags: ['old'],
    });
    expect(result.summary).toBe('summary:sess-1');
    expect(result.tags).toEqual(['alpha', 'beta']);
  });

  it('processBatch respects batchSize and batchIntervalMs', async () => {
    vi.useFakeTimers();
    const provider = createMockProvider();
    const engine = new ExtractionEngine(provider, { batchSize: 2, batchIntervalMs: 100 });
    const seen: number[] = [];

    const promise = engine.processBatch([1, 2, 3], async (n) => {
      seen.push(n);
    });

    await vi.runOnlyPendingTimersAsync();
    const processed = await promise;

    expect(processed).toBe(2);
    expect(seen).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it('rankMemories merges ranked lists and returns topK', () => {
    const provider = createMockProvider();
    const engine = new ExtractionEngine(provider, {});

    const results = engine.rankMemories(
      [
        [{ key: 'a', rank: 1 }, { key: 'b', rank: 2 }],
        [{ key: 'b', rank: 1 }, { key: 'c', rank: 3 }],
      ],
      2,
    );

    expect(results).toHaveLength(2);
    expect(results[0].key).toBeDefined();
    expect(new Set(results.map((r) => r.key)).size).toBe(2);
    expect(results.map((r) => r.key)).toEqual(['b', 'c']);
  });
});
