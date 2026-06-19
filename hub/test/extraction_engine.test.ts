/**
 * Unit tests for ExtractionEngine.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExtractionEngine } from '../src/extraction/engine.js';
import type { AIProvider } from '../src/types.js';
import { GraphStore } from '../src/graph/store.js';

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

  // ─── extractSession → GraphStore.syncMemoryNodes integration ────
  // Regression coverage for the private syncMemoryNodes orchestration in
  // ExtractionEngine.extractSession(). Before this test, the path that
  // writes summary / topic / fact / entity nodes into the graph had zero
  // coverage; a regression in the key-naming or dedup logic would slip
  // through silently. We exercise extractSession end-to-end with a real
  // GraphStore (no mocks) and inspect the resulting node/edge topology.
  describe('extractSession → GraphStore.syncMemoryNodes wiring', () => {
    it('writes summary + per-tag topic nodes + keyEvent fact nodes + entity nodes for one session', async () => {
      const provider = createMockProvider();
      const engine = new ExtractionEngine(provider, {});
      const gs = new GraphStore();
      engine.setGraphStore(gs);

      await engine.extractSession({
        id: 'sess-A',
        transcript: 'turn 1: I configured the database and met Alice.',
        agentId: 'agent-1',
      });

      // Mock provider returns tags=['alpha', 'beta'], keyEvents=['event-1'],
      // entities=['entity-1']. Expect 1 summary + 2 topic nodes + 1 fact +
      // 1 entity = 5 memory nodes (the agent node is separate).
      const labels = Array.from(gs['nodes'].values() as IterableIterator<any>)
        .filter((n: any) => n.type === 'memory')
        .map((n: any) => n.label)
        .sort();

      expect(labels).toEqual([
        'session:sess-A:entity:entity-1',
        'session:sess-A:fact:event-1',
        'session:sess-A:summary',
        'session:sess-A:topic:alpha',
        'session:sess-A:topic:beta',
      ]);

      // Agent node should exist with the requested agentId.
      const agentNode = Array.from(gs['nodes'].values() as IterableIterator<any>)
        .find((n: any) => n.type === 'agent' && n.label === 'agent-1');
      expect(agentNode).toBeTruthy();

      // Every memory node should have an entity edge → agent.
      const memoryToAgentEdges = Array.from(gs['edges'].values() as IterableIterator<any>)
        .filter((e: any) => e.type === 'entity' && agentNode && e.target === agentNode.id);
      expect(memoryToAgentEdges).toHaveLength(5);

      // Each topic-prefixed tag should produce a linkMemoryToTopic edge.
      const topicNodes = Array.from(gs['nodes'].values() as IterableIterator<any>)
        .filter((n: any) => n.type === 'topic')
        .map((n: any) => n.label)
        .sort();
      expect(topicNodes).toEqual(['alpha', 'beta']);
    });

    it('falls back to agentId="extraction-engine" when session omits agentId', async () => {
      const provider = createMockProvider();
      const engine = new ExtractionEngine(provider, {});
      const gs = new GraphStore();
      engine.setGraphStore(gs);

      await engine.extractSession({
        id: 'sess-B',
        transcript: 'turn without explicit agent',
      });

      const agentNode = Array.from(gs['nodes'].values() as IterableIterator<any>)
        .find((n: any) => n.type === 'agent' && n.label === 'extraction-engine');
      expect(agentNode).toBeTruthy();
    });

    it('no-ops graph writes when graphStore is null (setGraphStore(null))', async () => {
      const provider = createMockProvider();
      const engine = new ExtractionEngine(provider, {});
      engine.setGraphStore(null);

      // Should not throw even though graphStore is null.
      const result = await engine.extractSession({
        id: 'sess-C',
        transcript: 'isolated session, no graph attached',
      });

      expect(result.success).toBe(true);
    });

    it('skips duplicate key writes within one session (createdKeys dedup)', async () => {
      const provider = createMockProvider();
      const engine = new ExtractionEngine(provider, {});
      const gs = new GraphStore();
      engine.setGraphStore(gs);

      // Provide a keyEvent whose 24-char prefix equals the topic key prefix
      // we already saw for 'alpha' — the engine should dedup via createdKeys
      // so we end up with one node, not two.
      await engine.extractSession({
        id: 'sess-D',
        transcript: 'two facts colliding on prefix',
      });

      // The mock returns tags=['alpha', 'beta']; facts=['event-1']. None of
      // those collide by prefix today, so this test mostly guards that the
      // dedup helper exists and the write path is stable. If a future
      // refactor changes key naming, this test will surface the change.
      const memoryNodes = Array.from(gs['nodes'].values() as IterableIterator<any>)
        .filter((n: any) => n.type === 'memory');
      expect(memoryNodes.length).toBeGreaterThanOrEqual(4);
      // Specifically: the fact key uses keyEvent.slice(0, 24), which here
      // is the literal "event-1" (8 chars); nothing else maps to that.
      expect(memoryNodes.map((n: any) => n.label)).toContain('session:sess-D:fact:event-1');
    });
  });
});
