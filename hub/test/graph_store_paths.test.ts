import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../src/graph/store.js';
import type { GraphEdge, GraphNode } from '../src/graph/types.js';

describe('GraphStore uncovered paths', () => {
  let gs: GraphStore;

  beforeEach(() => {
    gs = new GraphStore();
  });

  // ─── Accessors: getNode / getEdge ────────────────────────────
  describe('Accessors', () => {
    it('getNode returns the live node and undefined for unknown ids', () => {
      const n = gs.addNode({ type: 'memory', label: 'm1', metadata: { a: 1 } });
      expect(gs.getNode(n.id)!.id).toBe(n.id);
      expect(gs.getNode(n.id)!.metadata.a).toBe(1);
      expect(gs.getNode('nope')).toBeUndefined();
    });

    it('getEdge returns the live edge and undefined for unknown ids', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      const e = gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', weight: 0.5, metadata: {} });
      expect(gs.getEdge(e.id)!.id).toBe(e.id);
      expect(gs.getEdge(e.id)!.weight).toBe(0.5);
      expect(gs.getEdge('nope')).toBeUndefined();
    });
  });

  // ─── Boolean failure arms ────────────────────────────────────
  describe('Removal returns', () => {
    it('removeNode returns false for an unknown id and leaves the store intact', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', metadata: {} });

      expect(gs.removeNode('nope')).toBe(false);
      expect(gs.getNodes().length).toBe(2);
      expect(gs.getEdges().length).toBe(1);

      expect(gs.removeNode(n1.id)).toBe(true);
    });

    it('removeEdge returns false for an unknown id and leaves the edge', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      const e = gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', metadata: {} });

      expect(gs.removeEdge('nope')).toBe(false);
      expect(gs.getEdges().length).toBe(1);
      expect(gs.removeEdge(e.id)).toBe(true);
    });

    it('updateNode returns undefined for an unknown id', () => {
      expect(gs.updateNode('nope', { label: 'x' })).toBeUndefined();
      expect(gs.getNodes().length).toBe(0);
    });

    it('linkMemoryToAgent no-ops for unknown endpoints instead of throwing', () => {
      const real = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      expect(() => gs.linkMemoryToAgent('nope', real.id)).not.toThrow();
      expect(() => gs.linkMemoryToAgent(real.id, 'nope')).not.toThrow();
      expect(gs.getEdges().length).toBe(0);
    });
  });

  // ─── getRelated: filters, missing node, and nodeTypes semantics ──
  describe('getRelated', () => {
    let m1: GraphNode;
    let a1: GraphNode;
    let a2: GraphNode;
    let t1: GraphNode;

    beforeEach(() => {
      m1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      a1 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      a2 = gs.addNode({ type: 'agent', label: 'a2', metadata: {} });
      t1 = gs.addNode({ type: 'topic', label: 't1', metadata: {} });
      gs.addEdge({ source: m1.id, target: a1.id, type: 'entity', metadata: {} });
      gs.addEdge({ source: m1.id, target: a2.id, type: 'causal', metadata: {} });
      gs.addEdge({ source: m1.id, target: t1.id, type: 'temporal', metadata: {} });
      // inbound: a1 -> m1
      gs.addEdge({ source: a1.id, target: m1.id, type: 'semantic', metadata: {} });
    });

    it('throws for an unknown node id', () => {
      expect(() => gs.getRelated('nope')).toThrow(/not found/);
    });

    it('returns both directions unfiltered', () => {
      const r = gs.getRelated(m1.id);
      expect(r.incoming.length).toBe(1);
      expect(r.incoming[0].source.id).toBe(a1.id);
      expect(r.outgoing.length).toBe(3);
      // pinned by id-set equality so an extra/duplicate push cannot pass vacuously
      expect(r.outgoing.map(o => o.target.id).sort()).toEqual([a1.id, a2.id, t1.id].sort());
    });

    it('edgeTypes filter applies to incoming AND outgoing arms', () => {
      const r = gs.getRelated(m1.id, { edgeTypes: ['causal'] });
      // the only causal edge is m1 -> a2
      expect(r.outgoing.length).toBe(1);
      expect(r.outgoing[0].target.id).toBe(a2.id);
      expect(r.outgoing[0].edge.type).toBe('causal');
      // the inbound edge is 'semantic' → filtered out by the same option
      expect(r.incoming.length).toBe(0);
    });

    it('edgeTypes:[] filters everything out (empty list is not "no filter")', () => {
      const r = gs.getRelated(m1.id, { edgeTypes: [] });
      expect(r.incoming.length).toBe(0);
      expect(r.outgoing.length).toBe(0);
    });

    it('nodeTypes filter applies to the NEIGHBOUR type, not the edge type', () => {
      const r = gs.getRelated(m1.id, { nodeTypes: ['topic'] });
      expect(r.outgoing.length).toBe(1);
      expect(r.outgoing[0].target.id).toBe(t1.id);
      expect(r.incoming.length).toBe(0);
    });

    it('nodeTypes filter on the incoming arm excludes a non-matching source', () => {
      const r = gs.getRelated(m1.id, { nodeTypes: ['topic'] });
      // a1 is an 'agent', so nothing inbound survives
      expect(r.incoming).toEqual([]);
    });

    it('combined edgeTypes + nodeTypes must both pass', () => {
      // 'causal' points at agent a2; nodeTypes ['topic'] rejects it
      const strict = gs.getRelated(m1.id, { edgeTypes: ['causal'], nodeTypes: ['topic'] });
      expect(strict.outgoing.length).toBe(0);
      // relaxing nodeTypes back to 'agent' lets the same edge through
      const loose = gs.getRelated(m1.id, { edgeTypes: ['causal'], nodeTypes: ['agent'] });
      expect(loose.outgoing.length).toBe(1);
    });
  });

  // ─── syncMemoryNode: the UPDATE arm (existing memory key) ─────
  describe('syncMemoryNode update path', () => {
    it('reuses the existing memory node on the second call (update, not create)', () => {
      const first = gs.syncMemoryNode('project/config', 'v1', 'agent1', []);
      const second = gs.syncMemoryNode('project/config', 'v2', 'agent1', []);

      expect(second.id).toBe(first.id);
      expect(second.metadata.value).toBe('v2');
      expect(gs.getNodes('memory').length).toBe(1);
      // the agent edge is NOT duplicated by the re-link
      expect(gs.getEdges({ type: 'entity' }).length).toBe(1);
    });

    it('bumps updatedAt but preserves id and createdAt', async () => {
      const first = gs.syncMemoryNode('k', 'v1', 'agent1', []);
      await new Promise(r => setTimeout(r, 2));
      const second = gs.syncMemoryNode('k', 'v2', 'agent1', []);
      expect(second.createdAt).toBe(first.createdAt);
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    });

    it('a NEW topic tag on an update still links the extra topic node', () => {
      gs.syncMemoryNode('k', 'v1', 'agent1', ['topic:alpha']);
      const before = gs.getNodes('topic').length;
      gs.syncMemoryNode('k', 'v2', 'agent1', ['topic:alpha', 'topic:beta']);
      expect(gs.getNodes('topic').length).toBe(before + 1);
      // 1 agent edge + 2 topic edges, all 'entity'
      expect(gs.getEdges({ type: 'entity' }).length).toBe(3);
    });

    it('does not re-link an already-linked topic (idempotent)', () => {
      gs.syncMemoryNode('k', 'v1', 'agent1', ['topic:alpha']);
      const edgesAfterFirst = gs.getEdges({ type: 'entity' }).length;
      gs.syncMemoryNode('k', 'v2', 'agent1', ['topic:alpha']);
      expect(gs.getEdges({ type: 'entity' }).length).toBe(edgesAfterFirst);
    });

    it('does not hijack a non-memory node that happens to share the label', () => {
      // A topic node already occupies the label 'shared-label'.
      const topic = gs.addNode({ type: 'topic', label: 'shared-label', metadata: {} });
      // syncMemoryNode must NOT adopt and mutate it — the lookup is
      // scoped to type==='memory', so a fresh memory node is created.
      const mem = gs.syncMemoryNode('shared-label', 'v1', 'agent1', []);
      expect(mem.id).not.toBe(topic.id);
      expect(mem.type).toBe('memory');
      // the topic node is untouched: same id, same (empty) metadata
      expect(gs.getNode(topic.id)!.type).toBe('topic');
      expect(gs.getNode(topic.id)!.metadata.value).toBeUndefined();
    });

    it('does not hijack an agent node that happens to share the label', () => {
      const agent = gs.addNode({ type: 'agent', label: 'agent1', metadata: { role: 'worker' } });
      const mem = gs.syncMemoryNode('agent1', 'v1', 'agent1', []);
      expect(mem.id).not.toBe(agent.id);
      expect(gs.getNode(agent.id)!.metadata.role).toBe('worker');
      // the pre-existing agent node is reused as the link target, not duplicated
      expect(gs.getNodes('agent').length).toBe(1);
      expect(gs.getEdges({ type: 'entity' }).length).toBe(1);
    });

    it('linkMemoryToTopic reuses an existing topic node by label', () => {
      const mem = gs.addNode({ type: 'memory', label: 'm', metadata: {} });
      gs.linkMemoryToTopic(mem.id, 'shared');
      gs.linkMemoryToTopic(mem.id, 'shared');
      expect(gs.getNodes('topic').length).toBe(1);
      expect(gs.getEdges({ type: 'entity' }).length).toBe(1);
    });
  });

  // ─── findSimilarMemories: existing-edge weight arm + guards ───
  describe('findSimilarMemories edge-weight arm', () => {
    const mem = (label: string) => gs.addNode({ type: 'memory', label, metadata: {} });
    const linkSemantic = (a: GraphNode, b: GraphNode, weight?: number) => {
      const e: Omit<GraphEdge, 'id' | 'createdAt'> = { source: a.id, target: b.id, type: 'semantic', metadata: {} };
      if (weight !== undefined) e.weight = weight;
      gs.addEdge(e);
    };

    it('uses the stored weight when a semantic edge already exists', () => {
      const a = mem('alpha');
      const b = mem('zzz-totally-different');
      linkSemantic(a, b, 0.9);

      // labels share no >2-char token → keyword similarity would be 0,
      // so this can ONLY be the stored-weight arm.
      expect(gs.findSimilarMemories(a.id, 0.7).map(n => n.id)).toEqual([b.id]);
      // the same edge is ignored when the threshold exceeds its weight
      expect(gs.findSimilarMemories(a.id, 0.95)).toEqual([]);
    });

    it('treats a weightless semantic edge as weight 0 via the `|| 0` fallback', () => {
      const a = mem('alpha');
      const b = mem('unrelated-label');
      linkSemantic(a, b); // no weight field

      expect(gs.findSimilarMemories(a.id, 0.2)).toEqual([]);
      // only a zero threshold lets the 0-fallback through
      expect(gs.findSimilarMemories(a.id, 0).map(n => n.id)).toEqual([b.id]);
    });

    it('weight 0 is falsy: it takes the same `|| 0` arm as a missing weight', () => {
      const a = mem('alpha');
      const b = mem('another-unrelated');
      linkSemantic(a, b, 0);
      expect(gs.findSimilarMemories(a.id, 0.2)).toEqual([]);
    });

    it('the semantic edge is directional: only source -> target is consulted', () => {
      const a = mem('alpha');
      const b = mem('unrelated-label');
      linkSemantic(a, b, 0.9);
      // b -> a is not a semantic edge, so b falls back to keyword similarity
      expect(gs.findSimilarMemories(b.id, 0.7)).toEqual([]);
    });

    it('returns [] for an unknown id and for a non-memory node', () => {
      mem('alpha');
      const agent = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      expect(gs.findSimilarMemories('nope')).toEqual([]);
      expect(gs.findSimilarMemories(agent.id)).toEqual([]);
    });

    it('excludes the query node from its own similarity results', () => {
      const a = mem('shared-token-label');
      mem('shared-token-label');
      const out = gs.findSimilarMemories(a.id, 0.1);
      expect(out).toHaveLength(1);
      expect(out.some(n => n.id === a.id)).toBe(false);
    });
  });

  // ─── computeTextSimilarity degenerate-token guard ────────────
  describe('similarity tokenization guards', () => {
    it('labels with no token longer than 2 chars score 0, never NaN', () => {
      const a = gs.addNode({ type: 'memory', label: 'a b', metadata: {} });
      const b = gs.addNode({ type: 'memory', label: 'c d', metadata: {} });
      // a high threshold must not be satisfied by a NaN/garbage score
      expect(gs.findSimilarMemories(a.id, 0.5)).toEqual([]);
      // the guard also applies when only ONE side is degenerate
      const c = gs.addNode({ type: 'memory', label: 'x y', metadata: {} });
      const d = gs.addNode({ type: 'memory', label: 'database connection', metadata: {} });
      gs.addEdge({ source: c.id, target: d.id, type: 'semantic', weight: 0.8, metadata: {} });
      expect(gs.findSimilarMemories(c.id, 0.5).map(n => n.id)).toEqual([d.id]);
    });

    it('splits on punctuation, not just whitespace', () => {
      const a = gs.addNode({ type: 'memory', label: 'alpha-beta', metadata: {} });
      const b = gs.addNode({ type: 'memory', label: 'alpha beta', metadata: {} });
      // identical token sets → score 1
      expect(gs.findSimilarMemories(a.id, 1).map(n => n.id)).toEqual([b.id]);
    });
  });
});
