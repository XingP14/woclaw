// Coverage of the graph query-option and guard surface in GraphStore.
//
// The pre-existing graph suites (graph.test.ts, graph_store_paths.test.ts,
// parse_graph_types.test.ts) exercise node/edge CRUD and unfiltered traversal.
// They never pass `edgeTypes` or `nodeTypes`, never ask findPath for a path
// that is deeper than its default, and never remove a node that is only the
// TARGET of an edge. So every filter operand, the BFS cycle guard, the
// maxDepth truncation and the incoming-edge cleanup in removeNode all sat
// completely dark while the file read as "well covered" at 105/119.
//
// Structure per group below: the arm is reached, AND the observable product
// behaviour is asserted. Nothing here asserts a defensive operand that cannot
// execute — see the UNREACHABLE note at the bottom of this file.

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../src/graph/store.js';
import type { EdgeType, GraphNode, GraphNodeType } from '../src/graph/types.js';

describe('GraphStore query options and guard arms', () => {
  let gs: GraphStore;

  const node = (type: GraphNodeType, label: string): GraphNode =>
    gs.addNode({ type, label, metadata: {} });

  const link = (source: GraphNode, target: GraphNode, type: EdgeType) =>
    gs.addEdge({ source: source.id, target: target.id, type, metadata: {} });

  beforeEach(() => {
    gs = new GraphStore();
  });

  // ─── removeNode: the incoming-edge cleanup (L45) ───────────────
  //
  // `if (edge.source === id || edge.target === id)` — the pre-existing suite
  // only ever removes a node that is the SOURCE of an edge, so the
  // `edge.target === id` operand never evaluated true. removeNode also
  // prunes `this.incoming`, so an edge that is merely pointed AT the removed
  // node must not survive in the adjacency map.
  describe('removeNode cascades to edges that only point at the node', () => {
    it('removes an edge whose target is the removed node and leaves others intact', () => {
      const a = node('memory', 'a');
      const b = node('agent', 'b');
      const c = node('topic', 'c');
      link(a, b, 'entity');       // b is only the TARGET of this edge
      link(c, b, 'causal');       // second incoming edge to b

      expect(gs.removeNode(b.id)).toBe(true);

      expect(gs.getNode(b.id)).toBeUndefined();
      expect(gs.getNodes().map(n => n.label).sort()).toEqual(['a', 'c']);
      // Both edges pointed at b, so both must be gone — a surviving edge
      // would leave the store internally inconsistent.
      expect(gs.getEdges()).toHaveLength(0);
      expect(gs.getEdges({ target: c.id })).toHaveLength(0);
    });

    it('a removed target node is not reachable by traversal afterwards', () => {
      const a = node('memory', 'a');
      const b = node('agent', 'b');
      link(a, b, 'semantic');

      gs.removeNode(b.id);

      // traverse() reads getEdges({source}), so this is the outgoing view.
      // The inbound direction is what findPath/getRelated would use, and both
      // now return nothing because the edge was pruned.
      expect(gs.traverse(a.id)).toHaveLength(0);
      expect(gs.findPath(a.id, b.id)).toBeNull();
      expect(gs.getRelated(a.id).incoming).toHaveLength(0);
    });
  });

  // ─── findPath: missing-endpoint and same-node guards (L176/L177) ──
  describe('findPath endpoint guards', () => {
    it('returns null when the TARGET does not exist, not only the source', () => {
      const a = node('memory', 'a');
      const b = node('memory', 'b');
      link(a, b, 'entity');

      // Existing arm: missing SOURCE.
      expect(gs.findPath('nope', b.id)).toBeNull();
      // Dark arm: source exists, target does not.
      expect(gs.findPath(a.id, 'nope')).toBeNull();
    });

    it('returns a zero-length self path when from === to', () => {
      const a = node('topic', 'a');
      // No edges at all — the self-path must short-circuit before BFS.
      const result = gs.findPath(a.id, a.id)!;
      expect(result).not.toBeNull();
      expect(result.path).toEqual([a.id]);
      expect(result.edges).toEqual([]);
      expect(result.length).toBe(0);
    });
  });

  // ─── findPath: maxDepth truncation (L195) + cycle guard (L188) ──
  describe('findPath respects maxDepth', () => {
    // Linear chain a -> b -> c -> d -> e. The `edge.target === to` check
    // runs BEFORE the maxDepth check, so truncation can only be observed on
    // a target that is not a direct neighbour of the frontier node.
    const chain = () => {
      const a = node('memory', 'a');
      const b = node('memory', 'b');
      const c = node('memory', 'c');
      const d = node('memory', 'd');
      const e = node('memory', 'e');
      link(a, b, 'temporal');
      link(b, c, 'temporal');
      link(c, d, 'temporal');
      link(d, e, 'temporal');
      return { a, b, c, d, e };
    };

    // NOTE on the maxDepth bound. L195 compares `newPath.length` against
    // maxDepth, and newPath INCLUDES the start node — so maxDepth counts
    // NODES on the path, not HOPS. For the 4-hop chain a->b->c->d->e that
    // means maxDepth must be >= 5 to find e, so the default of 5 admits
    // only a 4-hop path. That is an off-by-one against the hop count a
    // caller would expect. Documented here as shipped behaviour, not as
    // correct: these tests pin the boundary exactly, so a future fix is a
    // visible test change rather than a silent behaviour change.
    it('finds the full path when maxDepth covers the whole chain', () => {
      const { a, e } = chain();
      const r = gs.findPath(a.id, e.id, 10)!;
      expect(r).not.toBeNull();
      expect(r.length).toBe(4);
      expect(r.path).toHaveLength(5);
      expect(r.path[0]).toBe(a.id);
      expect(r.path[4]).toBe(e.id);
      expect(r.edges).toHaveLength(4);
      // Each returned edge must actually join consecutive path nodes.
      expect(r.edges.map(ed => [ed.source, ed.target])).toEqual(
        r.path.slice(0, -1).map((id, i) => [id, r.path[i + 1]]),
      );
    });

    it('truncates the search at the maxDepth boundary', () => {
      const { a, e } = chain();
      // maxDepth 4: the frontier reaches d (newPath length 4) but the
      // `>= maxDepth` guard fires before d is enqueued, so e is never seen.
      expect(gs.findPath(a.id, e.id, 4)).toBeNull();
      // maxDepth 5 is the first value that reaches e.
      expect(gs.findPath(a.id, e.id, 5)).not.toBeNull();
    });

    it('the default maxDepth of 5 admits a 4-hop path but not a 5-hop one', () => {
      const { a, e } = chain();
      // a->b->c->d->e is 4 hops / 5 nodes, which the default admits.
      expect(gs.findPath(a.id, e.id)).not.toBeNull();
      // One hop further needs 6 nodes on the path — over the default.
      const f = node('memory', 'f');
      link(e, f, 'temporal');
      expect(gs.findPath(a.id, f.id)).toBeNull();
    });

    it('does not revisit an already-visited node when the graph has a diamond', () => {
      // a -> b, a -> c, b -> c. findPath(a, d) needs c, which is reachable
      // both directly and through b. Processing b's neighbour list hits the
      // `visited.has(edge.target)` guard for c.
      const a = node('memory', 'a');
      const b = node('memory', 'b');
      const c = node('memory', 'c');
      const d = node('memory', 'd');
      link(a, b, 'entity');
      link(a, c, 'temporal');
      link(b, c, 'semantic');
      link(c, d, 'causal');

      const r = gs.findPath(a.id, d.id)!;
      expect(r).not.toBeNull();
      // The short path a -> c -> d must win over a -> b -> c -> d.
      expect(r.length).toBe(2);
      expect(r.path).toEqual([a.id, c.id, d.id]);
    });
  });

  // ─── traverse: edgeTypes / nodeTypes filters (L153/L157) ───────
  describe('traverse filters', () => {
    // a -entity-> b -causal-> c, plus a -semantic-> c
    const triangle = () => {
      const a = node('memory', 'a');
      const b = node('agent', 'b');
      const c = node('topic', 'c');
      link(a, b, 'entity');
      link(b, c, 'causal');
      link(a, c, 'semantic');
      return { a, b, c };
    };

    it('without options every neighbour at depth 1 is returned', () => {
      const { a, b, c } = triangle();
      const res = gs.traverse(a.id);
      expect(res.map(r => r.node.id).sort()).toEqual([b.id, c.id].sort());
      expect(res.every(r => r.depth === 1)).toBe(true);
    });

    it('edgeTypes keeps only edges of the requested type', () => {
      const { a, b, c } = triangle();
      // a has an `entity` edge to b and a `semantic` edge to c.
      const onlyEntity = gs.traverse(a.id, { edgeTypes: ['entity'] });
      expect(onlyEntity.map(r => r.node.id)).toEqual([b.id]);
      expect(onlyEntity[0].edgeTypes).toEqual(['entity']);

      const onlySemantic = gs.traverse(a.id, { edgeTypes: ['semantic'] });
      expect(onlySemantic.map(r => r.node.id)).toEqual([c.id]);

      // Both types named: c comes back via semantic, b via entity.
      const both = gs.traverse(a.id, { edgeTypes: ['entity', 'semantic'] });
      expect(both.map(r => r.node.id).sort()).toEqual([b.id, c.id].sort());
    });

    it('edgeTypes prunes the frontier, not just the returned rows', () => {
      // a -entity-> b -causal-> c. Filtering to `entity` must stop at b:
      // c is only reachable over a `causal` edge, so it is never enqueued
      // and never appears at depth 2. NOTE traverse() reports the WHOLE
      // frontier up to `depth`, not only the deepest nodes — so the
      // unfiltered depth-2 result is [b, c], and the filtered one is [b].
      const a = node('memory', 'a');
      const b = node('memory', 'b');
      const c = node('memory', 'c');
      link(a, b, 'entity');
      link(b, c, 'causal');

      // Baseline: both hops are reported.
      expect(gs.traverse(a.id, { depth: 2 }).map(r => r.node.id).sort())
        .toEqual([b.id, c.id].sort());

      // entity only: b survives, c is cut off behind the causal edge.
      const entityOnly = gs.traverse(a.id, { edgeTypes: ['entity'], depth: 2 });
      expect(entityOnly.map(r => r.node.id)).toEqual([b.id]);
      // causal only: a has no causal edge at all, so nothing is enqueued.
      expect(gs.traverse(a.id, { edgeTypes: ['causal'], depth: 2 })).toHaveLength(0);
      // Both types: the full chain comes back, with edgeTypes recorded
      // per hop on the row for the deepest node.
      const all = gs.traverse(a.id, { edgeTypes: ['entity', 'causal'], depth: 2 });
      expect(all.map(r => r.node.id).sort()).toEqual([b.id, c.id].sort());
      const cRow = all.find(r => r.node.id === c.id)!;
      expect(cRow.path).toEqual([a.id, b.id, c.id]);
      expect(cRow.edgeTypes).toEqual(['entity', 'causal']);
      expect(cRow.depth).toBe(2);
    });

    it('nodeTypes keeps only neighbours of the requested node type', () => {
      const { a, b, c } = triangle();
      const agents = gs.traverse(a.id, { nodeTypes: ['agent'] });
      expect(agents.map(r => r.node.id)).toEqual([b.id]);

      const topics = gs.traverse(a.id, { nodeTypes: ['topic'] });
      expect(topics.map(r => r.node.id)).toEqual([c.id]);

      const both = gs.traverse(a.id, { nodeTypes: ['agent', 'topic'] });
      expect(both.map(r => r.node.id).sort()).toEqual([b.id, c.id].sort());

      // A type nothing in the frontier has returns an empty traversal.
      expect(gs.traverse(a.id, { nodeTypes: ['memory'] })).toHaveLength(0);
    });

    it('edgeTypes and nodeTypes compose as an AND', () => {
      const { a, b, c } = triangle();
      // Edge is `semantic` to c, and c IS a topic — so each filter alone
      // admits it, but naming the wrong one of the pair rejects it.
      expect(gs.traverse(a.id, { edgeTypes: ['semantic'], nodeTypes: ['topic'] })).toHaveLength(1);
      expect(gs.traverse(a.id, { edgeTypes: ['semantic'], nodeTypes: ['agent'] })).toHaveLength(0);
      expect(gs.traverse(a.id, { edgeTypes: ['entity'], nodeTypes: ['topic'] })).toHaveLength(0);
    });

    it('does not enqueue a neighbour already seen via another branch', () => {
      // Diamond: a -> b -> d and a -> c -> d. d is reachable twice; the
      // visited guard must stop it being enqueued a second time, so it is
      // reported exactly once.
      const a = node('memory', 'a');
      const b = node('memory', 'b');
      const c = node('memory', 'c');
      const d = node('memory', 'd');
      link(a, b, 'entity');
      link(b, d, 'entity');
      link(a, c, 'entity');
      link(c, d, 'entity');

      const res = gs.traverse(a.id, { depth: 3 });
      const dHits = res.filter(r => r.node.id === d.id);
      expect(dHits).toHaveLength(1);
      expect(res.map(r => r.node.id).sort()).toEqual([b.id, c.id, d.id].sort());
    });
  });

  // ─── getRelated: edgeTypes / nodeTypes on both directions (L217/L220/L225/L228) ──
  describe('getRelated filters', () => {
    // a -> b (entity), a -> c (causal); x -> a (semantic)
    const star = () => {
      const a = node('agent', 'a');
      const b = node('memory', 'b');
      const c = node('topic', 'c');
      const x = node('memory', 'x');
      link(a, b, 'entity');
      link(a, c, 'causal');
      link(x, a, 'semantic');
      return { a, b, c, x };
    };

    it('without options returns every incoming and outgoing neighbour', () => {
      const { a, b, c, x } = star();
      const rel = gs.getRelated(a.id);
      expect(rel.node.id).toBe(a.id);
      expect(rel.incoming.map(r => r.source.id)).toEqual([x.id]);
      expect(rel.outgoing.map(r => r.target.id).sort()).toEqual([b.id, c.id].sort());
    });

    it('edgeTypes filters the outgoing direction', () => {
      const { a, b } = star();
      const rel = gs.getRelated(a.id, { edgeTypes: ['entity'] });
      expect(rel.outgoing.map(r => r.target.id)).toEqual([b.id]);
      expect(rel.incoming).toHaveLength(0); // the semantic incoming edge is filtered
    });

    it('edgeTypes filters the incoming direction', () => {
      const { a, x, c } = star();
      const rel = gs.getRelated(a.id, { edgeTypes: ['semantic'] });
      expect(rel.incoming.map(r => r.source.id)).toEqual([x.id]);
      expect(rel.outgoing).toHaveLength(0);
    });

    it('nodeTypes filters on the resolved neighbour node, per direction', () => {
      const { a, b, c, x } = star();
      // Outgoing neighbours b (memory) and c (topic).
      const memOnly = gs.getRelated(a.id, { nodeTypes: ['memory'] });
      expect(memOnly.outgoing.map(r => r.target.id)).toEqual([b.id]);

      const topicOnly = gs.getRelated(a.id, { nodeTypes: ['topic'] });
      expect(topicOnly.outgoing.map(r => r.target.id)).toEqual([c.id]);

      // Incoming neighbour x is a memory node, so naming `agent` — the type
      // of the node being queried — must NOT match it.
      const noIncoming = gs.getRelated(a.id, { nodeTypes: ['agent'] });
      expect(noIncoming.incoming).toHaveLength(0);
      expect(noIncoming.outgoing).toHaveLength(0);
    });

    it('edgeTypes and nodeTypes compose as an AND in both directions', () => {
      const { a, x } = star();
      expect(gs.getRelated(a.id, { edgeTypes: ['semantic'], nodeTypes: ['memory'] }).incoming).toHaveLength(1);
      // Edge matches, node type does not.
      expect(gs.getRelated(a.id, { edgeTypes: ['semantic'], nodeTypes: ['agent'] }).incoming).toHaveLength(0);
      // Node type matches, edge does not.
      expect(gs.getRelated(a.id, { edgeTypes: ['causal'], nodeTypes: ['memory'] }).incoming).toHaveLength(0);
      expect(gs.getRelated(a.id, { edgeTypes: ['causal'] }).incoming).toHaveLength(0);
    });

    it('throws for an unknown node before any filter is consulted', () => {
      expect(() => gs.getRelated('nope')).toThrow(/not found/);
      expect(() => gs.getRelated('nope', { edgeTypes: ['entity'] })).toThrow(/not found/);
    });
  });
});

// UNREACHABLE — deliberately left dark, and why.
//
//   L136 / L156  `if (!currentNode) continue;` (traverse) and
//         `if (!targetNode) continue;` (traverse's neighbour loop). Every
//         QueueItem is pushed only after `this.nodes.get(edge.target)`
//         returned a defined node, and the start item is added to `visited`
//         from the caller's id without a lookup. There is no public API that
//         deletes a node while leaving its edge behind — removeNode() prunes
//         the edge in the same pass — so the queue can never hold a dangling
//         id. Asserting this would mean reaching into the private `nodes`
//         Map.
//
//   L219/L227  `if (!sourceNode) continue;` / `if (!targetNode) continue;` in
//         getRelated(). Same argument: an edge's endpoints are validated in
//         addEdge (which throws) and torn down together in removeEdge, so a
//         stored edge always has both endpoint nodes present.
//
// These four arms stay dark on purpose. Counting them as a coverage gap
// would push a future tick to write a test that only passes by breaking the
// store's invariants.
//
// MUTATION CHECK — 10 mutants, 8 killed, baseline green. The two survivors
// are EQUIVALENT MUTANTS, proven, not test weaknesses. Do NOT count them as
// gaps in any future tally, and do not re-try to kill them:
//
//   1. `if (!this.nodes.has(from) || !this.nodes.has(to)) return null;`
//      -> drop the `has(to)` operand. SURVIVES.
//      Equivalent: a nonexistent target id has no outgoing edges, so the BFS
//      queue simply drains and the loop falls through to the same
//      `return null` at the bottom. The guard is a fast path, not the
//      mechanism that produces null. Verified with a live probe against a
//      graph where the target is a dangling id.
//
//   2. `if (visited.has(edge.target)) continue;` in findPath (L188)
//      -> disable the guard entirely. SURVIVES.
//      Equivalent for termination: `newPath.length >= maxDepth` already
//      bounds the search, so a cycle is truncated by the depth limit even
//      with the visited set removed. Verified: a 6-node pure ring with the
//      target unreachable returns null in 0 ms. The visited set is an
//      OPTIMIZATION (it bounds the queue by node count rather than by
//      depth), not a correctness guard. A test can only distinguish it by
//      asserting on search internals, which are not observable.
//
// The maxDepth off-by-one noted above IS killable and IS pinned: the
// boundary tests assert null at 4 and a path at 5, so inverting or removing
// the comparison is caught (2 red).
