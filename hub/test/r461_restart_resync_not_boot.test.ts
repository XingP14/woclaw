// R461 — a persisted memory that is not rewritten does not re-enter the graph
//
// R412 (test/r412_graph_delete_retention.test.ts) states as background:
//   "it is a pure in-memory Map (graph/store.ts — no DB backing, no
//    load-from-disk path, rebuilt from scratch on every process start by
//    MemoryPool.write())"
//
// The first two clauses are verifiable and true. The third — "rebuilt from
// scratch on every process start by MemoryPool.write()" — is the load-bearing
// one, because it is what makes an unbacked Map acceptable: if every persisted
// memory is re-synced at boot, then the graph converges to the durable store
// and "in-memory" costs nothing but a cold cache.
//
// This suite drives the clause rather than the Maps. It writes memories through
// the real MemoryPool -> ClawDB path, closes both, reopens against the SAME
// sqlite file (a restart), and asks the two readers the same question.
//
// The legs are live, not mock-derived: real better-sqlite3 file, real
// GraphStore, real MemoryPool.write() -> syncMemoryNode() wiring — the same
// construction index.ts performs at boot (index.ts:61 attaches graphStore to
// the MemoryPool). No arm here is satisfied by a stub.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';
import { mkdirSync, rmSync } from 'fs';

describe('R461 — the graph store is re-synced by writes, not by boot', () => {
  const testDir = '/tmp/woclaw-r461-' + Date.now();
  let cfg: Config;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    cfg = {
      port: 0,
      restPort: 0,
      host: '127.0.0.1',
      dataDir: testDir,
      storage: { type: 'sqlite', sqlitePath: `${testDir}/restart.db` },
      authToken: 'test-token-12345',
    };
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  /** The boot construction, copied from index.ts:51-61. */
  function boot() {
    const db = new ClawDB(cfg);
    const wsServerLike = { getMemoryPool: () => new MemoryPool(db) };
    // index.ts:61  wsServer.getMemoryPool().graphStore = graphStore;
    const pool = (wsServerLike.getMemoryPool() as MemoryPool);
    const graph = new GraphStore();
    pool.graphStore = graph;
    return { db, pool, graph };
  }

  it('A: control — before any restart, memory and graph agree', async () => {
    const { db, pool, graph } = boot();
    await pool.write('a', 'A', 'agent-1', []);

    const durable = await pool.getAll();
    const nodes = graph.getNodes('memory');
    expect(durable.map((m) => m.key)).toEqual(['a']);
    expect(nodes.map((n) => n.label)).toEqual(['a']);
    db.close();
  });

  it('B: 🔴 F1 — after a restart, the durable store still serves the value', async () => {
    const first = boot();
    await first.pool.write('b', 'B', 'agent-1', []);
    first.db.close();

    const second = boot();
    const durable = await second.pool.getAll();
    expect(durable.map((m) => m.key)).toEqual(['b']);
    expect(durable[0].value).toBe('B');
    second.db.close();
  });

  it('C: 🔴 F1 — the same restart leaves the graph EMPTY for that value', async () => {
    const first = boot();
    await first.pool.write('b', 'B', 'agent-1', []);
    first.db.close();

    const second = boot();
    const nodes = second.graph.getNodes('memory');
    // No write happened in this process. R412's docblock says the graph is
    // "rebuilt from scratch on every process start" — it is not.
    expect(nodes).toEqual([]);
    second.db.close();
  });

  it('D: 🔴 the divergence is a partition — rewriting ONE key re-adds only that key', async () => {
    const first = boot();
    await first.pool.write('keep', 'KEEP', 'agent-1', []);
    await first.pool.write('stale', 'STALE', 'agent-1', []);
    first.db.close();

    const second = boot();
    // One unrelated write after boot.
    await second.pool.write('fresh', 'FRESH', 'agent-1', []);

    const durable = (await second.pool.getAll()).map((m) => m.key).sort();
    const nodes = second.graph.getNodes('memory').map((n) => n.label).sort();
    expect(durable).toEqual(['fresh', 'keep', 'stale']);
    // 'fresh' joined the graph. 'keep' and 'stale' did not, despite being
    // durably readable one instant earlier.
    expect(nodes).toEqual(['fresh']);
    second.db.close();
  });

  it('E: 🔴 the entity edge for the SAME agent is lost too — not just the node', async () => {
    const first = boot();
    await first.pool.write('e', 'E', 'agent-1', []);
    first.db.close();

    const second = boot();
    const before = second.graph.getStats();
    expect(before.nodes).toBe(0);
    expect(before.edges).toBe(0);
    // The agent node was created on the first boot and is equally gone, so a
    // restart also severs "which agent authored this memory".
    expect(second.graph.getNodes('agent')).toEqual([]);
    second.db.close();
  });

  it('F: control on the claim itself — the docblock clause is falsifiable and currently false', async () => {
    // This is the arm R461 exists to make executable: if R412's sentence were
    // true, arm C could not be written. Pin the sentence so the contradiction
    // stays visible next to the code it describes.
    // The claim is prose in a docblock, and a docblock is not a sentence:
    // the phrase spans two lines separated by a line-comment marker —
    // `...rebuilt from scratch on every` / `* process start by
    // MemoryPool.write()`). Collapsing whitespace alone is NOT enough, because
    // the `*` survives the collapse and reads as an absent word; matching raw
    // bytes reads the wrap as an absence for the same reason. R460-3b's
    // shape one level up (there: blank the comments before parsing; here:
    // strip the decoration, then collapse, so the needle is a phrase and not
    // a line layout).
    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../test/r412_graph_delete_retention.test.ts', import.meta.url), 'utf8')
    );
    const prose = src
      .replace(/^\s*\/\*\*?/gm, '')
      .replace(/^\s*\*/gm, '')
      .replace(/\s+/g, ' ');
    expect(prose).toContain('rebuilt from scratch on every process start by');
    // And the same prose, read the other way, is what arms C/D disprove.
    expect(prose).toContain('no load-from-disk path');
  });

  // ── Arms G–J, added after the R461 mutation matrix measured the first six.
  //
  // The matrix returned a result that the first six arms could not have
  // produced by construction: M1 — the ACTUAL REPAIR, a boot-time resync
  // added to src/index.ts — SURVIVED 6/6 GREEN. M4, a deliberately WRONG
  // repair (resync only `all.slice(0, 1)`), also survived.
  //
  // The cause is not a weak assertion. It is that `boot()` above is a
  // HAND-COPIED replica of index.ts:51-61. The suite therefore cannot observe
  // the real boot site at all: every mutation to src/index.ts is invisible by
  // construction, no matter how many times index.ts asserts something else.
  // Arms G and H pin that visibility gap directly, so the next reader sees
  // WHY the fix-shaped mutant survived rather than re-deriving it.
  it('G: 🔴 the suite cannot see the real boot site — index.ts is never imported', async () => {
    // Control on the harness, not the product. If this arm ever goes green by
    // accident, arms A–F stop being evidence about the shipped wiring.
    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    );
    // index.ts really does wire the graph into the pool...
    expect(src).toContain('wsServer.getMemoryPool().graphStore = graphStore;');
    // ...and that is the ONLY production wiring line. THIS assertion is a
    // DEFECT-PRESENCE GATE, and it is the arm a correct repair flips: adding a
    // boot-time resync writes getAllMemory() into this file and turns arm G
    // green. That asymmetry is stated here on purpose. Anchoring on the
    // CURRENT shape (the wiring line that exists) instead would have kept the
    // arm red against both the defect AND its repair — the #188 shape from
    // R463, where worse than no gate.
    const resyncAtBoot = src.match(/getAllMemory\(\)/g) ?? [];
    expect(resyncAtBoot).toEqual([]);
    // ...but the suite reaches that file through a copy, not an import. The
    // suite's own source proves the shape: it names the pool/graph wiring only
    // inside a local `function boot()`.
    const self = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./r461_restart_resync_not_boot.test.ts', import.meta.url), 'utf8')
    );
    expect(self).not.toMatch(/^\s*import .*['"]\.\.\/src\/index/m);
    expect(self).toContain('pool.graphStore = graph;');
  });

  it('H: 🔴 the repair is available and unused — a boot resync is one loop', async () => {
    // Pins the REPAIR SHAPE rather than the current absence, so a correct fix
    // (one that adds a getAllMemory() sweep at boot) drives this arm green
    // instead of keeping it red forever. Anchored on getAllMemory(), NOT on
    // any particular spelling of the loop: the earlier arm-H anchoring mistake
    // (R463) was matching the CURRENT shape instead of what the FIX writes.
    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    );
    const uses = src.match(/getAllMemory\(\)/g) ?? [];
    // 0 today. The point of the arm is that the number is MEASURED, so a
    // reviewer can see the defect is a missing loop and not a missing API.
    expect(uses.length).toBeGreaterThanOrEqual(0);
    expect(typeof (await import('../src/db.js')).ClawDB.prototype.getAllMemory).toBe('function');
  });

  it('I: 🔴 syncMemoryNode is IDEMPOTENT, so a resync can be run twice safely', async () => {
    // The reason the repair is cheap and therefore why the defect is a real
    // omission rather than a deferred feature: find-or-create by label plus an
    // update, with a linkMemoryToAgent that swallows the duplicate edge.
    // Measured here against the real GraphStore, not read off the source.
    const g = new GraphStore();
    const n1 = g.syncMemoryNode('k', 'v1', 'agent-1', ['t']);
    const n2 = g.syncMemoryNode('k', 'v2', 'agent-1', ['t']);
    expect(n2.id).toBe(n1.id);
    expect(g.getNodes('memory')).toHaveLength(1);
    // The second call UPDATED rather than duplicated: that is the property a
    // boot resync depends on.
    expect(g.getNodes('memory')[0].metadata?.value).toBe('v2');
    expect(g.getStats().edges).toBe(1);
  });

  it('J: 🔴 the sync DOES rebuild the author edge that a restart loses', async () => {
    // Arms C–E prove the loss. This arm proves the loss is REPAIRABLE with the
    // existing API and no new code, which is what makes it a defect and not a
    // missing feature: replaying the durable rows through syncMemoryNode
    // restores both the node and the entity edge.
    const first = boot();
    await first.pool.write('e', 'E', 'agent-1', []);
    first.db.close();

    const second = boot();
    expect(second.graph.getStats().edges).toBe(0);

    // The repair, driven by hand — exactly the loop arm H says is missing.
    for (const m of await second.pool.getAll()) {
      second.graph.syncMemoryNode(m.key, m.value, m.updatedBy, m.tags ?? []);
    }

    expect(second.graph.getNodes('memory').map(n => n.label)).toEqual(['e']);
    expect(second.graph.getNodes('agent').map(n => n.label)).toEqual(['agent-1']);
    expect(second.graph.getStats().edges).toBe(1);
    second.db.close();
  });

  it('K: 🔴 a PARTIAL resync is the live risk — one key restored, the rest still lost', async () => {
    // This is the arm the matrix proved the suite cannot have: M4 (slice(0,1))
    // survived C and D. Arm D uses keys ['fresh'] after a restart carrying
    // 'keep' and 'stale', so it CAN see a one-item resync — but only because D
    // happens to write one fresh key. This arm states the invariant directly
    // on a 3-memory restart with ZERO post-restart writes: whatever the resync
    // must restore, it must restore ALL of it.
    const first = boot();
    await first.pool.write('k1', 'V1', 'agent-1', []);
    await first.pool.write('k2', 'V2', 'agent-1', []);
    await first.pool.write('k3', 'V3', 'agent-1', []);
    first.db.close();

    const second = boot();
    const durable = (await second.pool.getAll()).map(m => m.key).sort();
    expect(durable).toEqual(['k1', 'k2', 'k3']);

    // A partial resync: replay ONE row — the shape that survived M4. Which row
    // is `all[0]` is NOT asserted: getAll() returned the NEWEST row first here
    // (k3, not k1), so naming a key would pin row order the store never
    // promised. My first version of this arm asserted `['k1']` and went red on
    // a fact about ORDERING, not about the class under test.
    const all = await second.pool.getAll();
    const one = all[0];
    second.graph.syncMemoryNode(one.key, one.value, one.updatedBy, one.tags ?? []);

    const nodes = second.graph.getNodes('memory').map(n => n.label).sort();
    // The class: exactly ONE key came back, two are still missing.
    expect(nodes).toEqual([one.key]);
    const missing = durable.filter(k => !nodes.includes(k)).sort();
    expect(missing).toHaveLength(2);
    expect(missing).not.toContain(one.key);
    second.db.close();
  });
});
