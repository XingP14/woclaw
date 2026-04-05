import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../src/graph/store.js';

describe('GraphStore', () => {
  let gs: GraphStore;

  beforeEach(() => {
    gs = new GraphStore();
  });

  // ─── Node CRUD ──────────────────────────────────────────────
  describe('Node CRUD', () => {
    it('adds and retrieves a node', () => {
      const node = gs.addNode({ type: 'memory', label: 'test-key', metadata: { foo: 'bar' } });
      expect(node.type).toBe('memory');
      expect(node.label).toBe('test-key');
      expect(node.metadata.foo).toBe('bar');
      expect(node.id).toBeTruthy();
    });

    it('gets all nodes or filtered by type', () => {
      gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      gs.addNode({ type: 'memory', label: 'm2', metadata: {} });
      gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      expect(gs.getNodes().length).toBe(3);
      expect(gs.getNodes('memory').length).toBe(2);
      expect(gs.getNodes('agent').length).toBe(1);
    });

    it('removes a node and its connected edges', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', metadata: {} });
      expect(gs.getNodes().length).toBe(2);
      expect(gs.getEdges().length).toBe(1);
      gs.removeNode(n1.id);
      expect(gs.getNodes().length).toBe(1);
      expect(gs.getEdges().length).toBe(0);
    });

    it('updates a node', () => {
      const node = gs.addNode({ type: 'memory', label: 'test', metadata: {} });
      const updated = gs.updateNode(node.id, { label: 'updated', metadata: { x: 1 } });
      expect(updated!.label).toBe('updated');
      expect(updated!.metadata.x).toBe(1);
    });
  });

  // ─── Edge CRUD ─────────────────────────────────────────────
  describe('Edge CRUD', () => {
    it('adds and retrieves edges', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      const edge = gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', weight: 0.9, metadata: { note: 'test' } });
      expect(edge.id).toBeTruthy();
      expect(gs.getEdges({ type: 'entity' }).length).toBe(1);
      expect(gs.getEdges({ source: n1.id }).length).toBe(1);
      expect(gs.getEdges({ target: n2.id }).length).toBe(1);
    });

    it('throws when adding edge to non-existent node', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      expect(() => gs.addEdge({ source: n1.id, target: 'fake-id', type: 'entity', metadata: {} }))
        .toThrow();
    });

    it('removes an edge', () => {
      const n1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      const edge = gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', metadata: {} });
      gs.removeEdge(edge.id);
      expect(gs.getEdges().length).toBe(0);
    });
  });

  // ─── Traversal ─────────────────────────────────────────────
  describe('Traversal', () => {
    let m1: ReturnType<typeof gs.addNode>;
    let a1: ReturnType<typeof gs.addNode>;
    let a2: ReturnType<typeof gs.addNode>;

    beforeEach(() => {
      m1 = gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      a1 = gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      a2 = gs.addNode({ type: 'agent', label: 'a2', metadata: {} });
      gs.addEdge({ source: m1.id, target: a1.id, type: 'entity', metadata: {} });
      gs.addEdge({ source: a1.id, target: a2.id, type: 'entity', metadata: {} });
    });

    it('finds direct neighbors (depth=1)', () => {
      const results = gs.traverse(m1.id, { depth: 1 });
      expect(results.length).toBe(1);
      expect(results[0].node.id).toBe(a1.id);
      expect(results[0].depth).toBe(1);
    });

    it('finds multi-hop neighbors (depth=2)', () => {
      const results = gs.traverse(m1.id, { depth: 2 });
      const ids = results.map(r => r.node.id).sort();
      expect(ids).toContain(a1.id);
      expect(ids).toContain(a2.id);
    });

    it('finds path between two nodes', () => {
      const path = gs.findPath(m1.id, a2.id);
      expect(path).not.toBeNull();
      expect(path!.path).toEqual([m1.id, a1.id, a2.id]);
      expect(path!.length).toBe(2);
    });

    it('returns null when no path exists', () => {
      const orphan = gs.addNode({ type: 'topic', label: 'orphan', metadata: {} });
      const path = gs.findPath(m1.id, orphan.id);
      expect(path).toBeNull();
    });

    it('gets related nodes with incoming and outgoing edges', () => {
      const related = gs.getRelated(m1.id);
      expect(related.node.id).toBe(m1.id);
      expect(related.outgoing.length).toBe(1);
      expect(related.outgoing[0].target.id).toBe(a1.id);
      expect(related.incoming.length).toBe(0);
    });
  });

  // ─── Auto-linking ────────────────────────────────────────────
  describe('Auto-linking', () => {
    it('syncMemoryNode creates memory + agent nodes and links them', () => {
      const memNode = gs.syncMemoryNode('project/config', '{"theme":"dark"}', 'test-agent', []);
      expect(memNode.type).toBe('memory');
      expect(memNode.label).toBe('project/config');
      const agentNodes = gs.getNodes('agent');
      expect(agentNodes.length).toBe(1);
      expect(agentNodes[0].label).toBe('test-agent');
      const edges = gs.getEdges({ source: memNode.id, type: 'entity' });
      expect(edges.length).toBe(1);
      expect(edges[0].target).toBe(agentNodes[0].id);
    });

    it('syncMemoryNode with topic: tag creates topic node and links', () => {
      gs.syncMemoryNode('project/tags', 'data', 'agent1', ['topic:general', 'topic:backend']);
      const topicNodes = gs.getNodes('topic');
      expect(topicNodes.length).toBe(2);
      const memNode = gs.getNodes('memory')[0];
      const topicEdges = gs.getEdges({ source: memNode.id, type: 'entity' });
      expect(topicEdges.length).toBe(3); // 1 agent + 2 topics
    });

    it('findSimilarMemories returns semantically similar memories', () => {
      gs.syncMemoryNode('project-config', 'database connection settings', 'agent1', []);
      gs.syncMemoryNode('server-config', 'database username and password', 'agent1', []);
      gs.syncMemoryNode('unrelated-note', 'what I ate for lunch today', 'agent1', []);
      const mem1 = gs.getNodes('memory')[0];
      // Debug: check all nodes
      expect(gs.getNodes('memory').map(n => n.label)).toEqual(['project-config', 'server-config', 'unrelated-note']);
      const similar = gs.findSimilarMemories(mem1.id, 0.2);
      // server-config shares "config" token with project-config → similar
      expect(similar.some(n => n.label === 'server-config')).toBe(true);
      // unrelated-note has no common tokens → not similar
      expect(similar.some(n => n.label === 'unrelated-note')).toBe(false);
    });
  });

  // ─── Stats ───────────────────────────────────────────────────
  describe('Stats', () => {
    it('returns correct stats', () => {
      gs.addNode({ type: 'memory', label: 'm1', metadata: {} });
      gs.addNode({ type: 'agent', label: 'a1', metadata: {} });
      gs.addNode({ type: 'topic', label: 't1', metadata: {} });
      const n1 = gs.addNode({ type: 'memory', label: 'm2', metadata: {} });
      const n2 = gs.addNode({ type: 'agent', label: 'a2', metadata: {} });
      gs.addEdge({ source: n1.id, target: n2.id, type: 'entity', metadata: {} });
      gs.addEdge({ source: n1.id, target: n2.id, type: 'semantic', metadata: {} });

      const stats = gs.getStats();
      expect(stats.nodes).toBe(5);
      expect(stats.edges).toBe(2);
      expect(stats.byType.nodes.memory).toBe(2);
      expect(stats.byType.nodes.agent).toBe(2);
      expect(stats.byType.nodes.topic).toBe(1);
      expect(stats.byType.edges.entity).toBe(1);
      expect(stats.byType.edges.semantic).toBe(1);
    });
  });
});
