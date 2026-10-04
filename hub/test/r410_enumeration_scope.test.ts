/**
 * R409.7 — apply the `scope` guard to the four ENUMERATION paths.
 *
 * R408 (commit 444449f) added `scope` to the four paths that take a `key`
 * argument (read / delete / getVersions / search) and reported coverage as 5/5.
 * R409 enumerated the denominator and found 4 of 8, not 5 of 5: the paths
 * that *enumerate* rather than look up — getAll, recall, recallByText,
 * queryByTag — never read `scope` at all. `GET /memory` is the broadest read
 * in the system and the one a caller reaches without knowing a key, so the
 * uncovered paths are the ones that do not require prior knowledge.
 *
 * Written RED-first against 444449f. It does NOT pin the marker: `isVisibleInScope`
 * still matches a caller-supplied substring/tags OR, and `ws_server.ts:132` still
 * reads a self-asserted `agentId`. See #407-1 / R404-F2 — coverage improved,
 * the forgery underneath did not.
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
const SS_KEY = 'openclaw:session:main:agent:main:cron:abc';
const PLAIN_KEY = 'deploy/bastion1/ssh-key';

describe('R409.7 — scope guard on the enumeration paths', () => {
  const testDir = '/tmp/woclaw-r410-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;
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
    const graph = new GraphStore();
    mp.graphStore = graph;
    restServer = new RestServer(cfg, db, topics, mp, graph, wsServer);
    await seed();
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function seed(): Promise<void> {
    await mp.write(WS_KEY, 'SSH_KEY', 'rest-api', ['infra'], 0);
    await mp.write(SS_KEY, 'CRON', 'rest-api', ['session'], 0);
    await mp.write(PLAIN_KEY, 'PLAINTEXT', 'rest-api', ['infra'], 0);
  }

  /** Capture the JSON body one of the private list handlers writes. */
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

  // ---- 1. getAll ---------------------------------------------------------
  it('1. getAll() honours a scope', async () => {
    expect((await mp.getAll()).length).toBe(3);
    expect((await mp.getAll('workspace')).map(m => m.key)).toEqual([WS_KEY]);
    expect((await mp.getAll('session')).map(m => m.key)).toEqual([SS_KEY]);
  });

  it('2. getAll() with an unknown scope falls back to all (default unchanged)', async () => {
    expect((await mp.getAll('nonsense')).length).toBe(3);
  });

  // ---- 2. recall ---------------------------------------------------------
  it('3. recall() honours a scope', async () => {
    expect((await mp.recall('PLAINTEXT')).map(m => m.key)).toEqual([PLAIN_KEY]);
    expect((await mp.recall('PLAINTEXT', undefined, 10, 'workspace')).length).toBe(0);
    expect((await mp.recall('CRON', undefined, 10, 'workspace')).length).toBe(0);
    expect((await mp.recall('SSH_KEY', undefined, 10, 'workspace')).map(m => m.key)).toEqual([WS_KEY]);
  });

  // ---- 3. recallByText ---------------------------------------------------
  it('4. recallByText() honours a scope', async () => {
    expect((await mp.recallByText('PLAINTEXT')).length).toBe(3); // Jaccard returns top-N regardless of score
    const scoped = await mp.recallByText('PLAINTEXT', 10, 'workspace');
    expect(scoped.every(m => m.key === WS_KEY)).toBe(true);
    expect(scoped.length).toBe(1);
  });

  // ---- 4. queryByTag -----------------------------------------------------
  it('5. queryByTag() honours a scope', async () => {
    expect((await mp.queryByTag('infra')).map(m => m.key).sort())
      .toEqual([PLAIN_KEY, WS_KEY].sort());
    expect((await mp.queryByTag('infra', 'workspace')).map(m => m.key)).toEqual([WS_KEY]);
    expect((await mp.queryByTag('infra', 'session')).length).toBe(0);
  });

  // ---- 5. the transport --------------------------------------------------
  it('6. GET /memory (handleMemoryList) with no scope returns everything', async () => {
    const all = await capture('handleMemoryList', null);
    expect(all.status).toBe(200);
    expect(all.body.memory.length).toBe(3);
  });

  it('7. handleMemoryList with a scope returns only in-scope records', async () => {
    const scoped = await capture('handleMemoryList', null, 'workspace');
    expect(scoped.body.memory.length).toBe(1);
    expect(scoped.body.memory[0].key).toBe(WS_KEY);
  });

  it('8. handleMemoryRecall passes scope through to recall', async () => {
    const blocked = await capture('handleMemoryRecall', 'PLAINTEXT', undefined, 10, 'workspace');
    expect(blocked.body.results.length).toBe(0);
    const allowed = await capture('handleMemoryRecall', 'SSH_KEY', undefined, 10, 'workspace');
    expect(allowed.body.results.length).toBe(1);
  });

  it('9. handleMemoryByTag passes scope through to queryByTag', async () => {
    const scoped = await capture('handleMemoryByTag', 'infra', 'workspace');
    expect(scoped.body.memory.length).toBe(1);
    expect(scoped.body.memory[0].key).toBe(WS_KEY);
  });

  // ---- 6. the default must not move (R408 Rule 2) ----------------------
  it('10. omitting scope everywhere still returns everything (no outage)', async () => {
    expect((await mp.getAll()).length).toBe(3);
    expect((await mp.recall('PLAINTEXT')).length).toBe(1);
    expect((await mp.queryByTag('infra')).length).toBe(2);
  });
});
