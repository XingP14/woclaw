/**
 * R412 — deleting a memory does not delete its copy in the graph store.
 *
 * R411 (581abf3) recorded a second copy of every memory living in
 * `GraphStore`, and case 1 of that probe observed — as a fact, not a
 * complaint — that the copy SURVIVES an authorised delete of the memory:
 *
 *     expect(await mp.delete(WS_KEY, 'workspace')).toBe(true);
 *     expect(await mp.getAll('workspace')).toEqual([]);
 *     const ws = graph.getNodes('memory').find(n => n.label === WS_KEY);
 *     expect(ws).toBeDefined();
 *     expect(ws!.metadata.value).toBe(WS_VALUE);   // <-- still there
 *
 * That is a *retention* gap, and it is strictly stronger than R411's
 * read-scope gap. R411 is about a caller who asks for a narrower scope
 * and is refused. This is about a caller who asks to delete, is told
 * `{"success": true, "deleted": "<key>"}`, and the plaintext value is
 * still served in full by `GET /graph/nodes?type=memory` and
 * `GET /graph/nodes/:id`. No scope parameter is even needed — the
 * default route hands it over.
 *
 * The graph store is not a durable audit log that ought to outlive the
 * memory: it is a pure in-memory `Map` (`graph/store.ts` — no DB
 * backing, no load-from-disk path, rebuilt from scratch on every
 * process start by `MemoryPool.write()`). A retention obligation cannot
 * live in a structure that does not survive restart. So this is a
 * retention failure, not a design choice.
 *
 * R411 deliberately did NOT fix anything (it is a documented probe).
 * This suite is the RED that turns its observation into a contract.
 *
 * Case 5 of R411 records that `traverse()` is NOT the exfiltration path
 * (it terminates at agent nodes with empty metadata), so the leak is
 * confined to the node list and the single-node get. Cases 2–4 here stay
 * on those two routes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

const WS_KEY = 'openclaw:workspace:infra:ssh-key';
const WS_VALUE = 'SSH_PRIVATE_KEY_MATERIAL';
const SS_KEY = 'openclaw:session:main:agent:main:cron:abc';
const SS_VALUE = 'CRON_SECRET_VALUE';
const PLAIN_KEY = 'deploy/bastion1/ssh-key';

describe('R412 — a deleted memory must not survive in the graph store', () => {
  const testDir = '/tmp/woclaw-r412-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;
  let graph: GraphStore;
  let restServer: RestServer;

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
    const wsServer = new WSServer(cfg, db);
    mp = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    graph = new GraphStore();
    mp.graphStore = graph;
    restServer = new RestServer(cfg, db, topics, mp, graph, wsServer);
    await seed();
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function seed(): Promise<void> {
    await mp.write(WS_KEY, WS_VALUE, 'rest-api', ['infra'], 0);
    await mp.write(SS_KEY, SS_VALUE, 'rest-api', ['session'], 0);
    await mp.write(PLAIN_KEY, 'PLAINTEXT', 'rest-api', ['infra'], 0);
  }

  async function capture(
    handler: string,
    ...args: unknown[]
  ): Promise<{ status: number; body: any }> {
    let status = 0;
    let body = '';
    const res = {
      setHeader: () => undefined,
      writeHead: (s: number) => { status = s; },
      end: (b: string) => { body = b; }
    } as any;
    await (restServer as any)[handler](res, ...args);
    return { status, body: body ? JSON.parse(body) : null };
  }

  function memoryNode(label: string) {
    return graph.getNodes('memory').find(n => n.label === label);
  }

  // ---- 1. the store-level copy is gone ------------------------------------
  it('1. the graph copy is removed when the memory is deleted', async () => {
    expect(await mp.delete(WS_KEY, 'workspace')).toBe(true);
    expect(await mp.getAll('workspace')).toEqual([]);
    expect(memoryNode(WS_KEY)).toBeUndefined();
  });

  // ---- 2. a delete that is REFUSED must not evict the copy either -------
  // The guard can refuse; the graph must not be the fallback copy that
  // makes a refused delete still destructive-looking-or-not.
  it('2. a refused delete leaves both copies intact', async () => {
    // 'session' scope does not match a workspace key, so the guard refuses.
    expect(await mp.delete(WS_KEY, 'session')).toBe(false);
    expect(await mp.read(WS_KEY, 'all')).toBeDefined();
    expect(memoryNode(WS_KEY)).toBeDefined();
  });

  // ---- 3. the other memories are untouched ------------------------------
  // The removal must be by key, not a wholesale clear of the memory nodes.
  it('3. deleting one memory leaves the other two alone', async () => {
    await mp.delete(WS_KEY, 'workspace');
    expect(graph.getNodes('memory').length).toBe(2);
    expect(memoryNode(SS_KEY)!.metadata.value).toBe(SS_VALUE);
    expect(memoryNode(PLAIN_KEY)!.metadata.value).toBe('PLAINTEXT');
  });

  // ---- 4. the value is gone from the two leaking REST routes -------------
  it('4. neither the node list nor the node get serves the deleted value', async () => {
    const before = graph.getNodes('memory').map(n => n.label);
    expect(before).toContain(WS_KEY);
    await mp.delete(WS_KEY, 'workspace');

    const { status, body } = await capture('handleGraphNodesList', 'memory');
    expect(status).toBe(200);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(WS_KEY);
    expect(serialised).not.toContain(WS_VALUE);
  });

  // ---- 5. deleting the last memory empties the type ----------------------
  it('5. deleting every memory empties the memory node type', async () => {
    for (const key of [WS_KEY, SS_KEY, PLAIN_KEY]) {
      await mp.delete(key, 'all');
    }
    expect(graph.getNodes('memory')).toEqual([]);
    const { body } = await capture('handleGraphNodesList', 'memory');
    expect(body.count).toBe(0);
  });

  // ---- 6. a rewrite keeps exactly one copy ------------------------------
  // syncMemoryNode is find-or-create by label; if removal ever creates a
  // second node for the same key, the write path would re-link it and the
  // store would grow a duplicate per delete/write cycle.
  it('6. rewrite-after-delete reuses the single node for that key', async () => {
    await mp.delete(WS_KEY, 'workspace');
    await mp.write(WS_KEY, 'NEW_VALUE', 'rest-api', ['infra'], 0);
    const nodes = graph.getNodes('memory').filter(n => n.label === WS_KEY);
    expect(nodes.length).toBe(1);
    expect(nodes[0].metadata.value).toBe('NEW_VALUE');
  });

  // ---- 7. a memory with no graph node at all ----------------------------
  // `index.ts:61` attaches the graph store to the pool AFTER the servers are
  // constructed, so a memory written during that window is mirrored to
  // nothing. Deleting it must still report success, and must not throw or
  // be reported as "not found" — the memory existed; only its copy is absent.
  it('7. deleting a memory that was never mirrored still succeeds', async () => {
    const orphanDir = '/tmp/woclaw-r412-orphan-' + Date.now();
    mkdirSync(orphanDir, { recursive: true });
    const odb = new ClawDB({ ...cfg, dataDir: orphanDir, storage: { type: 'sqlite', sqlitePath: `${orphanDir}/o.db` } });
    try {
      const omp = new MemoryPool(odb);          // no graphStore attached
      await omp.write('early:window:key', 'EARLY_VALUE', 'rest-api', ['infra'], 0);

      omp.graphStore = graph;                   // attached late, as index.ts does
      expect(omp.read('early:window:key', 'all')).toBeDefined();
      expect(await omp.delete('early:window:key', 'all')).toBe(true);
      expect(await omp.read('early:window:key', 'all')).toBeUndefined();
      // The three seeded nodes are untouched by a delete that found nothing.
      expect(graph.getNodes('memory').length).toBe(3);
    } finally {
      await odb.close();
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });

  // ---- 8. a failed DB delete must NOT evict the copy --------------------
  // The unmirror is guarded by `deleted &&`. If that guard is ever weakened
  // to `this.graphStore` alone, a delete that FAILED at the storage layer
  // would still destroy the graph copy of a memory that still exists in the
  // DB — the copy would be gone and the record would be intact, which is
  // strictly worse than doing nothing: it makes the graph look like the
  // authoritative store for a memory that was never deleted.
  //
  // `deleteMemory` is an interface method on ClawDB, so it can be stubbed to
  // return false. The guard refuses nothing here: the scope is 'all' and the
  // key is readable, so the ONLY thing standing between a failed delete and
  // a destroyed copy is the `deleted &&` conjunct itself.
  it('8. a delete that failed at the DB keeps the graph copy', async () => {
    const original = db.deleteMemory.bind(db);
    (db as any).deleteMemory = async (_key: string) => false;
    try {
      expect(await mp.delete(WS_KEY, 'all')).toBe(false);
    } finally {
      (db as any).deleteMemory = original;
    }
    // The memory itself is untouched...
    expect((await mp.read(WS_KEY, 'all'))!.value).toBe(WS_VALUE);
    // ...and so is its copy. Case 3's count arithmetic depends on this.
    expect(memoryNode(WS_KEY)).toBeDefined();
    expect(memoryNode(WS_KEY)!.metadata.value).toBe(WS_VALUE);
    expect(graph.getNodes('memory').length).toBe(3);
  });

  // ---- 9. removeMemoryNode must report honestly on an absent node -------
  // `if (!memNode) return false;` is the line that distinguishes "I removed
  // your copy" from "there was no copy". Returning `true` for an absent node
  // makes the store lie to a caller that is deciding whether it still holds
  // a value it is obliged to destroy. Nothing else in the suite reads this
  // return value, so a mutation here survives every other case.
  it('9. removeMemoryNode reports false when no copy exists', async () => {
    expect(graph.removeMemoryNode(WS_KEY)).toBe(true);
    // Second call: the node is genuinely gone now.
    expect(graph.removeMemoryNode(WS_KEY)).toBe(false);
    // A key that was never mirrored is also false, not true.
    expect(graph.removeMemoryNode('never:mirrored:key')).toBe(false);
  });

  // ---- 10. the unmirror is best-effort, never fatal --------------------
  // A graph store that throws mid-teardown must not turn a successful delete
  // into a thrown error, and must not be reported as a failure. This pins the
  // try/catch that makes the unmirror "best effort" rather than "required".
  it('10. a graph store that throws does not fail the delete', async () => {
    const throwing = {
      removeMemoryNode: () => { throw new Error('store torn down mid-delete'); }
    };
    const real = mp.graphStore;
    mp.graphStore = throwing as any;
    try {
      expect(await mp.delete(WS_KEY, 'all')).toBe(true);
      expect(await mp.read(WS_KEY, 'all')).toBeUndefined();
    } finally {
      mp.graphStore = real;
    }
  });
});
