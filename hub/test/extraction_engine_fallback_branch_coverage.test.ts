/**
 * Default/fallback branch coverage for ExtractionEngine.
 *
 * `hub/test/extraction_engine.test.ts` pins the happy paths but its mock
 * provider always returns `tags`, `keyEvents` and `entities`, and its
 * rankMemories cases always use positive ranks. That leaves four fallback
 * arms dark:
 *
 *   - engine.ts:78  `const tags = result.tags ?? []`
 *   - engine.ts:82  `if (createdKeys.has(key)) return;` (duplicate node key)
 *   - engine.ts:91  `for (const fact of result.keyEvents ?? [])`
 *   - engine.ts:94  `for (const entity of result.entities ?? [])`
 *   - engine.ts:118 `rrf * (rank > 0 ? rank : 1)`
 *
 * All of these are load-bearing: `syncMemoryNodes` is what keeps the graph
 * store in sync with an extraction result, and if the provider returns a
 * partial result (some local models omit entities/keyEvents) the engine must
 * still sync the summary rather than throw on `undefined`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExtractionEngine } from '../src/extraction/engine.js';
import type { AIProvider } from '../src/types.js';

interface SyncCall {
  key: string;
  value: string;
  agentId: string;
  extraTags: string[];
}

/** Minimal GraphStore stand-in: records every syncMemoryNode call. */
function recordingGraphStore() {
  const calls: SyncCall[] = [];
  return {
    calls,
    store: {
      syncMemoryNode: (key: string, value: string, agentId: string, extraTags: string[] = []) => {
        calls.push({ key, value, agentId, extraTags });
      },
    } as unknown as Parameters<ExtractionEngine['setGraphStore']>[0],
  };
}

/** Provider whose extractSession returns EXACTLY the given partial result. */
function providerReturning(partial: Record<string, unknown>): AIProvider {
  return {
    scoreMemory: vi.fn(async () => ({ success: true, score: 1, reasoning: '', suggestedTags: [] })),
    extractSession: vi.fn(async (session) => ({
      success: true,
      summary: `summary:${session.id}`,
      ...partial,
    })) as unknown as AIProvider['extractSession'],
  } as AIProvider;
}

describe('ExtractionEngine syncMemoryNodes fallback arms', () => {
  it('syncs the summary only when the provider omits tags/keyEvents/entities', async () => {
    const { calls, store } = recordingGraphStore();
    const engine = new ExtractionEngine(providerReturning({}), {});
    engine.setGraphStore(store);

    const result = await engine.extractSession({ id: 's-empty', transcript: 't' });

    // Provider returned none of the three optional arrays: no throw, and the
    // summary node is still synced.
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('session:s-empty:summary');
    expect(calls[0].value).toBe('summary:s-empty');
    expect(calls[0].extraTags).toEqual([]);
  });

  it('falls back to [] for tags but still walks keyEvents/entities', async () => {
    const { calls, store } = recordingGraphStore();
    const engine = new ExtractionEngine(
      providerReturning({ keyEvents: ['k1'], entities: ['e1'] }),
      {},
    );
    engine.setGraphStore(store);

    await engine.extractSession({ id: 's-mixed', transcript: 't' });

    // tags missing -> default [] -> the summary node carries no extra tags,
    // and the two loops still create their nodes (both inheriting tags=[]).
    expect(calls.map((c) => c.key)).toEqual([
      'session:s-mixed:summary',
      'session:s-mixed:fact:k1',
      'session:s-mixed:entity:e1',
    ]);
    expect(calls.every((c) => c.extraTags.length === 0)).toBe(true);
  });

  it('deduplicates node keys so a tag equal to a fact/entity only syncs once', async () => {
    const { calls, store } = recordingGraphStore();
    // 'shared' appears as a topic, and again as the start of a fact and an
    // entity key... the exact keys differ, so use a topic that is ALSO the
    // agentId-style suffix collision: tag 'summary' collides with the
    // summary node only if the id matches — instead assert the real dedupe
    // path with a repeated tag entry.
    const engine = new ExtractionEngine(
      providerReturning({ tags: ['dup', 'dup'], keyEvents: ['dup'], entities: ['dup'] }),
      {},
    );
    engine.setGraphStore(store);

    await engine.extractSession({ id: 's-dup', transcript: 't' });

    // topic:dup is emitted twice in the loop but createdKeys short-circuits
    // the second one; fact:dup and entity:dup are distinct keys.
    const topicCount = calls.filter((c) => c.key === 'session:s-dup:topic:dup').length;
    expect(topicCount).toBe(1);
    expect(calls.map((c) => c.key)).toEqual([
      'session:s-dup:summary',
      'session:s-dup:topic:dup',
      'session:s-dup:fact:dup',
      'session:s-dup:entity:dup',
    ]);
  });

  it('skips graph sync entirely when no graph store is attached', async () => {
    const provider = providerReturning({ tags: ['a'] });
    const engine = new ExtractionEngine(provider, {});

    // No setGraphStore() call: the `if (!this.graphStore) return` guard must
    // short-circuit before the first `this.graphStore!` non-null assertion.
    const result = await engine.extractSession({ id: 's-nostore', transcript: 't' });

    expect(result.success).toBe(true);
    expect(provider.extractSession).toHaveBeenCalledOnce();
  });

  it('honours session.agentId for the synced node owner', async () => {
    const { calls, store } = recordingGraphStore();
    const engine = new ExtractionEngine(providerReturning({ tags: ['t1'] }), {});
    engine.setGraphStore(store);

    await engine.extractSession({ id: 's-agent', transcript: 't', agentId: 'agent-7' });

    expect(calls.every((c) => c.agentId === 'agent-7')).toBe(true);
  });
});

describe('ExtractionEngine rankMemories non-positive rank arm', () => {
  it('substitutes weight 1 for zero and negative ranks', () => {
    const engine = new ExtractionEngine(providerReturning({}), {});

    const ranked = engine.rankMemories([[{ key: 'a', rank: 0 }], [{ key: 'b', rank: -5 }]], 2);

    const byKey = Object.fromEntries(ranked.map((r) => [r.key, r.score]));
    // RRF: key 'a' is at i=0 -> rrf=1/61, weight clamped 0 -> 1.
    //       key 'b' is at i=0 -> rrf=1/61, weight clamped -5 -> 1.
    // Both are identical, so ordering falls back to insertion order.
    expect(byKey.a).toBeCloseTo(Math.round((1 / 61) * 1000) / 1000, 6);
    expect(byKey.b).toBeCloseTo(Math.round((1 / 61) * 1000) / 1000, 6);
    expect(ranked).toHaveLength(2);
  });

  it('still ranks a positive rank above a clamped one in the same list', () => {
    const engine = new ExtractionEngine(providerReturning({}), {});

    // 'first' has rank 0 at i=0, 'second' has rank 9 at i=1.
    // i=0 -> 1/61 * 1; i=1 -> 1/62 * 9  =>  0.1452 vs 0.0164.
    const ranked = engine.rankMemories(
      [
        [
          { key: 'first', rank: 0 },
          { key: 'second', rank: 9 },
        ],
      ],
      2,
    );

    expect(ranked[0].key).toBe('second');
    expect(ranked[0].score).toBeCloseTo(Math.round((9 / 62) * 1000) / 1000, 6);
    expect(ranked[1].key).toBe('first');
  });

  it('honours the topK default and returns fewer entries than input', () => {
    const engine = new ExtractionEngine(providerReturning({}), {});

    const ranked = engine.rankMemories([
      [
        { key: 'k1', rank: 1 },
        { key: 'k2', rank: 2 },
        { key: 'k3', rank: 3 },
      ],
    ]);

    expect(ranked).toHaveLength(3);
    const capped = engine.rankMemories(
      [
        [
          { key: 'k1', rank: 1 },
          { key: 'k2', rank: 2 },
        ],
      ],
      1,
    );
    expect(capped).toHaveLength(1);
    // k1 -> i=0, weight 1 => 1/61 = 0.0164; k2 -> i=1, weight 2 => 2/62 =
    // 0.0323. k2 legitimately outranks k1, so topK=1 keeps k2.
    expect(capped[0].key).toBe('k2');
    expect(capped[0].score).toBeCloseTo(Math.round((2 / 62) * 1000) / 1000, 6);
  });
});
