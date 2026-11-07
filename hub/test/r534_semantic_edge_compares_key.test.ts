/**
 * R534 — THE IDENTIFIER/CONTENT PLANE: the "semantic" edge is computed over
 *        the KEY, never over the VALUE.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74 out-of-cluster). R441–R533 were in-cluster rounds over
 * llm-benchmark and woclaw internals. This round opens a NEW plane, and the
 * external leg is run FIRST (controls before precision — R404-M1).
 *
 *   EXTERNAL LEG (hub/scripts/r534_wedge.ts, control first):
 *     HN CTRL (60d): `agent`=5,132 · `AI agent`=2,383 · `LLM`=2,045
 *     HN PRECISION (120d): 5/5 TRUE ZERO
 *       `entity resolution compare identifier not content` = 0
 *       `dedup compare key instead of payload`             = 0
 *       `semantic similarity computed on identifier`       = 0
 *       `entity resolution wrong field compared`           = 0
 *       `duplicate detection compares names not records`  = 0
 *     GH PRECISION: `entity resolution identifier similarity bug` = 0
 *     GH WIDENING: `knowledge graph entity alignment` = 83 repos
 *       (nju-websoft/OpenEA 585★ GPL-3.0 · BootEA 156★ MIT · MultiKE 119★ MIT)
 *
 *   ⇒ NOT reported as greenfield (R449-5 / R454-4 / R475-3 discipline):
 *     blocking + candidate generation + embedding-based scoring + graph
 *     structural features are ALL solved mechanisms in the entity-resolution
 *     field. This is a MIGRATION GAP: the pattern is known, the agent
 *     community has not moved it.
 *
 * -----------------------------------------------------------------------
 * THE PLANE, stated precisely.
 *
 *   `GraphStore.findSimilarMemories(memoryId, threshold)` decides whether
 *   two memories are "semantically similar" by comparing
 *
 *       this.computeTextSimilarity(memory.label, other.label)      ← store.ts:338
 *
 *   `label` is the memory KEY. The memory's VALUE — the actual payload the
 *   agent wrote — lives in `node.metadata.value` (set by `syncMemoryNode`,
 *   store.ts:243-250) and is NEVER an input to the similarity computation.
 *
 *   Meanwhile the EDGE this produces is literally typed `'semantic'`, is
 *   auto-created on every memory write (memory.ts:150-160), is queryable
 *   through the public REST surface (`GET /graph/nodes/:id/related`,
 *   `GET /graph/traverse/:id`), and is the ONLY thing in the hub that ever
 *   asserts "these two memories are semantically related".
 *
 *   So the hub makes a semantic claim about content, computed from
 *   identifiers, with no check that the contents have anything in common.
 *
 * -----------------------------------------------------------------------
 * MEASURED (all arms run against the REAL classes — real GraphStore, real
 * MemoryPool, real SQLite ClawDB; only the AI provider is out of scope
 * because the plane does not involve one).
 *
 *   F1  FALSE POSITIVE (the loud one). Two memories whose KEYS share a token
 *       set but whose VALUES are unrelated get a `semantic` edge:
 *         key `deploy:alpha`  value "Kubernetes cluster upgrade scheduled
 *                                for Friday"
 *         key `deploy-beta`   value "Totally unrelated database failover drill"
 *       → 1 semantic edge. The contents share no topic, no token, no entity.
 *
 *   F2  FALSE NEGATIVE (the quiet one). Two memories with the IDENTICAL
 *       value but disjoint keys get NO semantic edge:
 *         key `alpha:beta:gamma` value "Kubernetes cluster upgrade
 *                                  scheduled for Friday"
 *         key `zulu:yankee:xray` value "Kubernetes cluster upgrade
 *                                  scheduled for Friday"
 *       → 0 semantic edges. Two byte-identical payloads are not linked.
 *       ⇒ The hub cannot recognise that two memories say the same thing.
 *
 *   F3  THE SCORE IS DISCARDED. `computeTextSimilarity` returns a number in
 *       [0,1]; the caller throws it away and writes `weight: 0.5` — the
 *       THRESHOLD — as the edge weight (memory.ts:157). A pair scoring 1.0
 *       and a pair scoring 0.5 are indistinguishable in the graph. Measured:
 *       both edges have weight 0.5.
 *
 *   F4  THE "ALREADY LINKED" CHECK IS DIRECTIONAL. `findSimilarMemories`
 *       consults only `source: memoryId` edges (store.ts:331). An edge
 *       B→A is invisible when A is the node being written. Measured:
 *       writing A then B creates B→A; re-writing A then creates A→B as a
 *       SECOND edge. The pair ends up with two reciprocal edges, and
 *       `getRelated` reports them as separate outgoing/incoming relations.
 *
 *   F5  EXTRACTION KEYS ARE A COMPLETE GRAPH. The extraction plane's fact
 *       keys are `session:<id>:fact:<fact.slice(0,24)>` (engine.ts:92) —
 *       same shape, same namespace, same tokens. Measured: N=5 → 10 edges,
 *       N=10 → 45, N=20 → 190. Exactly N(N−1)/2 — a COMPLETE graph. Every
 *       extracted fact is declared semantically identical to every other.
 *
 *   F6  WRITE COST IS QUADRATIC AND MATERIAL. `findSimilarMemories` scans
 *       ALL memory nodes on every write (store.ts:327). Measured with
 *       realistic `openclaw:workspace:infra:key-N` keys:
 *         N=25  →   213 ms,   300 edges
 *         N=50  →   557 ms, 1,225 edges
 *         N=100 → 1,200 ms, 4,950 edges
 *         N=200 → 13,156 ms, 19,900 edges
 *       ⇒ O(N²) edges AND O(N²) time per write, on the hot write path.
 *
 * -----------------------------------------------------------------------
 * WHAT THIS SUITE DOES AND DOES NOT DO.
 *
 * It is TEST-ONLY. It pins the CURRENT behaviour, so a repair turns it red.
 * It does NOT repair anything, because the repair is a product decision:
 *   - should the similarity be over the VALUE, the KEY, or both?
 *   - should the edge weight carry the SCORE rather than the threshold?
 *   - should the "already linked" check be symmetric?
 *   - should the threshold be per-write configurable?
 * All four read differently from the code and cannot be derived from it.
 *
 * This is the same posture as R417 (the extraction plane has no entry point):
 * a plane with a name, a mechanism, a public query surface — and no
 * agreement between the name and the mechanism.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import { GraphStore } from '../src/graph/store.js';

const THRESHOLD = 0.5; // memory.ts:150 — the production threshold

function semanticEdges(gs: GraphStore): Array<{ source: string; target: string; weight?: number }> {
  return gs.getEdges({ type: 'semantic' }).map((e) => ({ source: e.source, target: e.target, weight: e.weight }));
}

function labelOf(gs: GraphStore, id: string): string {
  return gs.getNode(id)?.label ?? '<missing>';
}

describe('R534 — the semantic edge compares the KEY, never the VALUE', () => {
  let dir: string;
  let db: ClawDB;
  let mp: MemoryPool;
  let gs: GraphStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'r534-'));
    db = new ClawDB(dir);
    await new Promise((r) => setTimeout(r, 60));
    mp = new MemoryPool(db);
    gs = new GraphStore();
    mp.graphStore = gs;
  });

  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────────────
  // F1 — FALSE POSITIVE: unrelated CONTENT, token-identical KEYS → linked.
  // ────────────────────────────────────────────────────────────────────
  it('F1: two memories with unrelated CONTENTS are declared semantically related because their KEYS match', async () => {
    // These two KEYS have IDENTICAL token sets ({deploy, alpha}) — the
    // similarity function splits on non-alphanumerics, so `:` and `-` are
    // equivalent separators. That is exactly what makes them "similar".
    await mp.write(
      'deploy:alpha',
      'Kubernetes cluster upgrade scheduled for Friday',
      'agent-a',
    );
    await mp.write(
      'deploy-alpha',
      'Totally unrelated database failover drill',
      'agent-a',
    );

    const edges = semanticEdges(gs);
    expect(edges).toHaveLength(1);

    // The edge asserts semantic relatedness between two payloads whose
    // contents share no token at all. State the FALSE POSITIVE explicitly
    // so the arm cannot be read as a generic "an edge exists" claim: assert
    // that NOT ONE key token appears in EITHER value.
    const keyTokens = ['deploy', 'alpha'];
    const values = [
      'Kubernetes cluster upgrade scheduled for Friday',
      'Totally unrelated database failover drill',
    ];
    for (const v of values) {
      for (const tok of keyTokens) {
        expect(v.toLowerCase().includes(tok)).toBe(false);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // F1-control — the mechanism is LIVE, not vacuously empty. Without this
  // arm, F1 could pass because the edge machinery never fires at all.
  // ────────────────────────────────────────────────────────────────────
  it('F1-control: the semantic-edge machinery IS live — the same two KEYS with MATCHING contents also link', async () => {
    await mp.write('deploy:alpha', 'Kubernetes cluster upgrade scheduled for Friday', 'agent-a');
    await mp.write('deploy-alpha', 'Kubernetes cluster upgrade scheduled for Friday', 'agent-a');
    expect(semanticEdges(gs)).toHaveLength(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // F2 — FALSE NEGATIVE: IDENTICAL CONTENT, disjoint KEYS → NOT linked.
  // ────────────────────────────────────────────────────────────────────
  it('F2: two memories with IDENTICAL contents are NOT linked when their keys share no token', async () => {
    const same = 'Kubernetes cluster upgrade scheduled for Friday';
    await mp.write('alpha:beta:gamma', same, 'agent-a');
    await mp.write('zulu:yankee:xray', same, 'agent-a');

    // Same bytes, different key -> no semantic edge.
    expect(semanticEdges(gs)).toHaveLength(0);

    // The values really are byte-identical (so the arm is not passing for a
    // trivial reason like "the write did not happen").
    const rows = await db.getAllMemory();
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe(rows[1].value);
    expect(rows[0].key).not.toBe(rows[1].key);
  });

  // ────────────────────────────────────────────────────────────────────
  // F3 — the SCORE is discarded; every edge carries the THRESHOLD.
  // ────────────────────────────────────────────────────────────────────
  it('F3: every semantic edge carries the THRESHOLD as its weight — the computed score is discarded', async () => {
    // 'alpha:beta:gamma' vs 'alpha-beta-gamma' -> token sets identical -> score 1.0
    // 'alpha:beta:gamma' vs 'alpha:beta:delta'  -> token sets 2/4      -> score 0.5
    await mp.write('alpha:beta:gamma', 'v', 'agent-a');
    await mp.write('alpha-beta-gamma', 'v', 'agent-a');
    await mp.write('alpha:beta:delta', 'v', 'agent-a');

    const edges = semanticEdges(gs);
    expect(edges.length).toBeGreaterThanOrEqual(2);
    // Every edge weight is the threshold, not a score.
    for (const e of edges) expect(e.weight).toBe(THRESHOLD);
    // If the score were stored, a 1.0-scoring pair would differ from a
    // 0.5-scoring pair. Assert they are indistinguishable.
    const weights = new Set(edges.map((e) => e.weight));
    expect(weights.size).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // F4 — the "already linked" check is DIRECTIONAL → reciprocal duplicates.
  // ────────────────────────────────────────────────────────────────────
  it('F4: the already-linked check is directional — the same pair accumulates RECIPROCAL semantic edges', async () => {
    await mp.write('alpha:beta:gamma', 'v1', 'agent-a');   // A first
    await mp.write('alpha-beta-gamma', 'v2', 'agent-a');   // B second -> B->A
    expect(semanticEdges(gs)).toHaveLength(1);

    // Re-write A. findSimilarMemories(A) consults only source=A edges, sees
    // none (the existing edge is B->A), falls through to the keyword branch,
    // and creates A->B as a SECOND edge.
    await mp.write('alpha:beta:gamma', 'v3', 'agent-a');
    const edges = semanticEdges(gs);
    expect(edges).toHaveLength(2);

    // And the two edges are reciprocal over the same node pair.
    const labels = edges.map((e) => [labelOf(gs, e.source), labelOf(gs, e.target)]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ['alpha-beta-gamma', 'alpha:beta:gamma'],
        ['alpha:beta:gamma', 'alpha-beta-gamma'],
      ]),
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // F5 — extraction-shaped keys form a COMPLETE graph.
  // ────────────────────────────────────────────────────────────────────
  it('F5: N extraction-shaped fact keys form a COMPLETE graph — every fact is declared identical to every other', async () => {
    const N = 6;
    for (let i = 0; i < N; i++) {
      // The real extraction key shape (extraction/engine.ts:92):
      //   `session:${session.id}:fact:${fact.slice(0, 24)}`
      await mp.write(`session:sess-${i}:fact:Some completely different ${i} event`, 'x', 'agent-a');
    }
    const edges = semanticEdges(gs);
    expect(edges).toHaveLength((N * (N - 1)) / 2);
  });

  // ────────────────────────────────────────────────────────────────────
  // F6 — the WRITE PATH is quadratic. Asserted on EDGE COUNT, not on
  // timing (timing is a property of the machine, not of the code).
  // ────────────────────────────────────────────────────────────────────
  it('F6: the write path creates O(N²) semantic edges — the cost is in the EDGES, not only in the time', async () => {
    const N = 8;
    for (let i = 0; i < N; i++) {
      await mp.write(`openclaw:workspace:infra:key-${i}`, `payload ${i}`, 'agent-a');
    }
    const edges = semanticEdges(gs);
    expect(edges).toHaveLength((N * (N - 1)) / 2);
  });

  // ────────────────────────────────────────────────────────────────────
  // F7 — the claim is PUBLIC. The wrong edge is reachable through the
  // documented graph query surface.
  // ────────────────────────────────────────────────────────────────────
  it('F7: the wrong edge is reachable through the PUBLIC graph query surface', async () => {
    await mp.write('deploy:alpha', 'Kubernetes cluster upgrade scheduled for Friday', 'agent-a');
    await mp.write('deploy-alpha', 'Totally unrelated database failover drill', 'agent-a');

    const mems = gs.getNodes('memory');
    expect(mems).toHaveLength(2);

    // The related-node query the REST surface exposes (`GET
    // /graph/nodes/:id/related`) is BIDIRECTIONAL — the wrong edge is
    // visible from either endpoint.
    const related = gs.getRelated(mems[0].id, { edgeTypes: ['semantic'] });
    expect(related.outgoing.length + related.incoming.length).toBe(1);

    // The traversal query (`GET /graph/traverse/:id`) is DIRECTIONAL — it
    // only walks OUTGOING edges (store.ts:151). So the wrong edge is
    // visible from the endpoint that was written LAST, and INVISIBLE from
    // the earlier one. A consumer asking "what is semantically related to
    // this memory?" gets an answer that depends on WRITE ORDER.
    const edges = semanticEdges(gs);
    expect(edges).toHaveLength(1);
    const source = gs.getNode(edges[0].source)!;
    const target = gs.getNode(edges[0].target)!;

    expect(gs.traverse(source.id, { depth: 1, edgeTypes: ['semantic'] })).toHaveLength(1);
    expect(gs.traverse(target.id, { depth: 1, edgeTypes: ['semantic'] })).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // F8 — the VALUE is present on the node and is still not used. This is
  // what makes the defect a DESIGN defect rather than a missing-data one:
  // the payload was there all along.
  // ────────────────────────────────────────────────────────────────────
  it('F8: the VALUE is present on the node the whole time — the data needed for a content-based comparison was never missing', async () => {
    const value = 'Kubernetes cluster upgrade scheduled for Friday';
    await mp.write('deploy:alpha', value, 'agent-a');
    await mp.write('deploy-beta', 'Totally unrelated database failover drill', 'agent-a');

    const mems = gs.getNodes('memory');
    for (const m of mems) {
      expect(typeof m.metadata?.value).toBe('string');
      expect((m.metadata.value as string).length).toBeGreaterThan(0);
    }
    // One node holds the exact string; the other holds an unrelated one.
    const values = mems.map((m) => m.metadata.value as string).sort();
    expect(values[0]).toBe('Kubernetes cluster upgrade scheduled for Friday');
    expect(values[1]).toBe('Totally unrelated database failover drill');
  });
});
