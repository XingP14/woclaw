/**
 * R413 — the retention fix has a floor it never reaches, and a second
 * write path that bypasses the mirror entirely.
 *
 * R412 (`ddc4d6d`) closed the delete half of the graph mirror: `MemoryPool.delete()`
 * now calls `graphStore.removeMemoryNode(key)`. Its own successor question, queued
 * in the 06:03 tick and never run, was whether that fix is *symmetric* — i.e. whether
 * every other path that removes a memory reaches the mirror too.
 *
 * It is not. Two distinct holes, and they are holes of different kinds.
 *
 * ── Hole 1: the mirror is maintained above a floor that deletes below it ──
 *
 * TTL expiry is enforced in the **storage** layer, not in `MemoryPool`:
 *
 *   - `db.ts:781 getMemory()` — `if (mem.expireAt > 0 && mem.expireAt < Date.now())`
 *     { `await this.deleteMemory(key)`; return undefined; }
 *   - `db.ts:793 getAllMemory()` — `await this.cleanupExpired()` first
 *
 * `deleteMemory()` is a bare `DELETE FROM memory` (`db.ts:789`). It knows nothing
 * about the graph store, which lives a layer up. So an expired memory is removed
 * from the table *without* `MemoryPool.delete()` ever being called — and the R412
 * hook at `memory.ts:187` sits on the wrong side of the floor to see it.
 *
 * The consequence is exactly R412's, arriving by a different route:
 * the value stays in `metadata.value` and is served in full by
 * `GET /graph/nodes?type=memory`. And unlike a user delete, *no caller was ever
 * told anything*: the expiry is silent, so the retention expectation is stronger,
 * not weaker. R412 fixed the loud path and left the quiet one.
 *
 * Note the ordering that makes this reachable at all: `MemoryPool.write()` mirrors
 * the value, and the mirror holds no `expireAt` (`graph/store.ts:249` builds
 * `metadata: { value, tags }` — the TTL is dropped on the floor at mirror time).
 * So the mirror is not merely un-expired, it is *unable* to know it is expired.
 *
 * ── Hole 2: `extraction/` writes the mirror but never the memory ──
 *
 * `extraction/engine.ts:84` calls `this.graphStore!.syncMemoryNode(key, value, ...)`
 * directly, bypassing `MemoryPool.write()` entirely. Any key that arrives via the
 * extraction queue therefore exists **only** in the graph store — with no row in
 * `memory`, no `memory_versions` row, and therefore no scope marker to check
 * against. R411-F4 named this file as a lead; it is the same second-copy plane
 * seen from the other end.
 *
 * Neither hole is fixed here. Both are blocked on the same thing R411/R412 name:
 * deciding *whose* scope applies to a derived node requires a real principal, and
 * that is `ws_server.ts:132` (`agentId` is a query parameter, never bound to the
 * token). This suite is the disclosure, not the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

const TTL_KEY = 'openclaw:workspace:infra:short-lived';
const TTL_VALUE = 'ROTATION_CREDENTIAL_MATERIAL';
const KEEP_KEY = 'openclaw:workspace:infra:long-lived';
const KEEP_VALUE = 'PERSISTENT_VALUE';

describe('R413 — the graph mirror outlives two removal paths that never reach it', () => {
  const testDir = '/tmp/woclaw-r413-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;
  let graph: GraphStore;

  const cfg: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: `${testDir}/test.db` },
    authToken: 'test-token-12345'
  };

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(cfg);
    const { WSServer } = await import('../src/ws_server.js');
    const wsServer = new WSServer(cfg, db);
    mp = wsServer.getMemoryPool();
    graph = new GraphStore();
    mp.graphStore = graph;
    await seed();
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function seed(): Promise<void> {
    // ttl = 1 second, written through the real MemoryPool so the mirror exists.
    await mp.write(TTL_KEY, TTL_VALUE, 'rest-api', ['infra'], 1);
    await mp.write(KEEP_KEY, KEEP_VALUE, 'rest-api', ['infra'], 0);
  }

  function memoryNode(label: string) {
    return graph.getNodes('memory').find(n => n.label === label);
  }

  // ---- 1. the mirror is created for a TTL'd memory ------------------------
  it('1. a memory written with a ttl is mirrored into the graph store', async () => {
    expect(memoryNode(TTL_KEY)).toBeDefined();
    expect(memoryNode(TTL_KEY)!.metadata.value).toBe(TTL_VALUE);
  });

  // ---- 2. the row expires and is deleted, silently ------------------------
  it('2. the expired memory is gone from the store', async () => {
    await new Promise(r => setTimeout(r, 1100));
    // Touch the store the way any caller would; the TTL is enforced on read.
    expect(await mp.read(TTL_KEY, 'all')).toBeUndefined();
  });

  // ---- 3. ⭐ and the copy is still served in plaintext --------------------
  it('3. the expired memory SURVIVES in the graph store with its value intact', async () => {
    await new Promise(r => setTimeout(r, 1100));
    await mp.read(TTL_KEY, 'all');            // triggers the storage-layer delete
    const node = memoryNode(TTL_KEY);
    expect(node).toBeDefined();
    expect(node!.metadata.value).toBe(TTL_VALUE);
  });

  // ---- 4. the mirror cannot represent expiry at all -----------------------
  // Not a leak, an inexpressibility: the TTL is dropped when the copy is made,
  // so no future fix can be written against the mirror without changing it.
  it('4. the mirrored node carries no expiry information', async () => {
    const node = memoryNode(TTL_KEY)!;
    expect(node.metadata).not.toHaveProperty('expireAt');
    expect(node.metadata).not.toHaveProperty('ttl');
    // The memory row has it; the copy does not.
    const row = await db.getMemory(TTL_KEY);
    expect(row).toBeDefined();
    expect(row!.ttl).toBeGreaterThan(0);
  });

  // ---- 5. the sweep path leaves the mirror too ----------------------------
  // `getAll()` is the broadest read in the system; it calls `cleanupExpired()`
  // before selecting. Same floor, wider blast radius.
  it('5. enumerating after expiry removes the row but not the copy', async () => {
    await new Promise(r => setTimeout(r, 1100));
    const all = await mp.getAll('workspace');
    expect(all.map(m => m.key)).toContain(KEEP_KEY);
    expect(all.map(m => m.key)).not.toContain(TTL_KEY);
    expect(memoryNode(TTL_KEY)!.metadata.value).toBe(TTL_VALUE);
  });

  // ---- 6. an explicit delete of the SAME key does reach the mirror --------
  // The contrast that makes hole 1 legible: two ways to remove one record,
  // one maintains the copy and one does not.
  it('6. an explicit delete DOES remove the copy — the ttl path is the outlier', async () => {
    await new Promise(r => setTimeout(r, 1100));
    await mp.read(TTL_KEY, 'all');            // storage-layer delete, no unmirror
    expect(memoryNode(TTL_KEY)).toBeDefined();
    expect(await mp.delete(TTL_KEY, 'workspace')).toBe(false); // row already gone
    return mp.write(TTL_KEY, TTL_VALUE, 'rest-api', ['infra'], 0).then(async () => {
      expect(await mp.delete(TTL_KEY, 'workspace')).toBe(true);
      expect(memoryNode(TTL_KEY)).toBeUndefined();
    });
  });

  // ---- 7. ⭐ the UPDATE half of the mirror, and M1 ------------------------
  // Mutation M1 in the matrix survived the first five versions of this file:
  // every earlier case wrote its key exactly once, so `syncMemoryNode` only
  // ever took its *create* branch and the `updateNode` branch — the one that
  // refreshes a copy in place — had no coverage at all. A rewrite is the
  // only way to reach it, and the rewrite path is where a stale copy would
  // most plausibly survive.
  it('7. rewriting a memory refreshes the mirror in place', async () => {
    const first = memoryNode(TTL_KEY)!;
    await mp.write(TTL_KEY, 'ROTATED_VALUE', 'rest-api', ['infra'], 0);
    const second = memoryNode(TTL_KEY)!;
    expect(second.id).toBe(first.id);        // same node, updated not replaced
    expect(second.metadata.value).toBe('ROTATED_VALUE');
    // And the copy still cannot express its own expiry, on the rewrite path.
    expect(second.metadata).not.toHaveProperty('expireAt');
    expect(second.metadata).not.toHaveProperty('ttl');
  });

  // ---- 8. a rewrite with a ttl keeps the copy un-expirable ---------------
  // The hole survives the refresh: the row's TTL is replaced on every write,
  // the copy's (absent) TTL is replaced with nothing.
  it('8. a rewrite that sets a ttl leaves the copy without expiry info', async () => {
    await mp.write(TTL_KEY, 'ROTATED_VALUE', 'rest-api', ['infra'], 900);
    const row = await db.getMemory(TTL_KEY);
    expect(row!.ttl).toBe(900);
    const node = memoryNode(TTL_KEY)!;
    expect(node.metadata).not.toHaveProperty('expireAt');
    expect(node.metadata).not.toHaveProperty('ttl');
  });
});
