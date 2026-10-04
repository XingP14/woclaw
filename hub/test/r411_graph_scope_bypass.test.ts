/**
 * R411 — the graph store is a SECOND copy of every memory, and the scope guard
 * is not on it.
 *
 * R408 (444449f) added `scope` to the paths that take a key; R409 enumerated the
 * denominator and found 4 of 8; R410 (21cb985) brought it to 8/8 by adding the
 * four enumeration paths. All eight live in `MemoryPool`. Every round since has
 * reported coverage as a property of that class.
 *
 * `MemoryPool.write()` also calls `graphStore.syncMemoryNode(key, serialized, …)`,
 * and `GraphNode.metadata` inlines `{ value, tags }` — the *same* key, the *same*
 * value, the *same* tags. `GET /graph/nodes` returns those nodes whole.
 *
 * The denominator R410 enumerated was "the read paths on MemoryPool". The data
 * is reachable by more than one route, and only one route was counted. An access
 * verb is not the same as an access *surface*.
 *
 * This probe deliberately does NOT pin the marker forgery (R407-1 / R404-F2 are
 * still open). It pins the second surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';

const WS_KEY = 'openclaw:workspace:infra:ssh-key';
const WS_VALUE = 'SSH_PRIVATE_KEY_MATERIAL';
const SS_KEY = 'openclaw:session:main:agent:main:cron:abc';
const SS_VALUE = 'CRON_SECRET_VALUE';
const PLAIN_KEY = 'deploy/bastion1/ssh-key';

describe('R411 — scope guard does not cover the graph copy of memory', () => {
  const testDir = '/tmp/woclaw-r411-' + Date.now();
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

  // ---- 0. the copy exists at all -----------------------------------------
  it('0. a memory write also materialises a graph node holding the value', () => {
    const nodes = graph.getNodes('memory');
    expect(nodes.length).toBe(3);
    const ws = nodes.find(n => n.label === WS_KEY);
    expect(ws).toBeDefined();
    expect(ws!.metadata.value).toBe(WS_VALUE);
    expect(ws!.metadata.tags).toEqual(['infra']);
  });

  // ---- 1. the graph copy survives a scoped delete of the memory -----------
  it('1. the graph copy is untouched by a scoped delete of the memory', async () => {
    // Scope 'workspace' MATCHES the key, so the guard permits the delete —
    // this is the ordinary, authorised case, not a bypass of the guard itself.
    expect(await mp.delete(WS_KEY, 'workspace')).toBe(true);
    expect(await mp.getAll('workspace')).toEqual([]);
    // …but its value is still readable in full from the graph.
    const ws = graph.getNodes('memory').find(n => n.label === WS_KEY);
    expect(ws).toBeDefined();
    expect(ws!.metadata.value).toBe(WS_VALUE);
  });

  // ---- 2. enumeration has no scope parameter at all ----------------------
  it('2. handleGraphNodesList returns every scope, with no scope input', async () => {
    const { status, body } = await capture('handleGraphNodesList', undefined);
    expect(status).toBe(200);
    const labels = body.nodes.map((n: any) => n.label);
    expect(labels).toContain(WS_KEY);
    expect(labels).toContain(SS_KEY);
  });

  // ---- 3. the value travels in the response body, not behind a link ------
  it('3. the workspace value crosses the wire in the list response', async () => {
    const { body } = await capture('handleGraphNodesList', 'memory');
    const serialised = JSON.stringify(body);
    expect(serialised).toContain(WS_VALUE);
  });

  // ---- 4. the same absence on a single-node read -------------------------
  it('4. handleGraphNodeGet serves a scoped-away memory by id', async () => {
    const ws = graph.getNodes('memory').find(n => n.label === WS_KEY)!;
    const { status, body } = await capture('handleGraphNodeGet', ws.id);
    expect(status).toBe(200);
    expect(body.node.metadata.value).toBe(WS_VALUE);
  });

  // ---- 5. traversal is a NEGATIVE — recorded, not asserted as a leak -----
  it('5. traversal returns the agent node, whose metadata is empty', () => {
    // Edges are memory→agent (store.ts:259) and agent nodes have no outgoing
    // edges, so a traversal from a memory node terminates at an agent node.
    // Agent nodes are created with `metadata: {}` (store.ts:255), so traverse
    // is NOT a value-exfiltration path. First draft of this case asserted the
    // opposite and failed; the honest result is that the leak is in the node
    // list and node get, not in the graph walk.
    const ss = graph.getNodes('memory').find(n => n.label === SS_KEY)!;
    const results = graph.traverse(ss.id, { depth: 3, limit: 50 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.node.type === 'agent')).toBe(true);
    expect(results.every(r => !('value' in r.node.metadata))).toBe(true);
    expect(JSON.stringify(results)).not.toContain(WS_VALUE);
  });

  // ---- 6. no scope vocabulary exists on the graph surface at all ---------
  it('6. the graph query options have no scope field to fill in', () => {
    // A shape assertion on the *actual* type, not on a literal I built
    // myself — R410 Rule 2: a case that cannot fail is not evidence.
    // Every key GraphQueryOptions declares, read off the source at runtime.
    const src = readFileSync(
      new URL('../src/graph/types.ts', import.meta.url), 'utf8'
    );
    const block = src.slice(src.indexOf('export interface GraphQueryOptions'));
    const end = block.indexOf('}');
    const declared = Array.from(
      block.slice(0, end).matchAll(/^\s*(\w+)\??:/gm)
    ).map(m => m[1]);
    expect(declared).toEqual(['depth', 'edgeTypes', 'nodeTypes', 'limit']);
    expect(declared).not.toContain('scope');
  });
});
