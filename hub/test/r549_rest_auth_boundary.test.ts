/**
 * R549 — the REST GET authorization-boundary census (candidate 547.20).
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R547 measured the REQUEST path of the MCP bridge (it dropped every JSON-RPC
 * request). R547's own item 547.19 flagged a security posture it did NOT
 * measure: `GET /memory/:key` appeared to need no credential. R547 was honest
 * about this: *"读码不是测量"* (reading code is not measuring).
 *
 * This round turns that reading into a MECHANICAL CENSUS:
 *
 *   every route branch in `rest_server.ts`  →  its auth posture
 *   → verified against a REAL RestServer booted from THIS tree
 *
 * ── The plane ─────────────────────────────────────────────────────────────
 *
 * The hub has EXACTLY ONE authorization expression, at `rest_server.ts:236`:
 *
 *     const requiresAuth = method !== 'GET' || path === '/admin/token/status';
 *
 * So the entire authorization posture of a multi-hundred-endpoint REST surface
 * is decided by ONE boolean that says: *GET is free, everything else is
 * authenticated* — plus a single hand-listed exception.
 *
 * The plane is therefore NOT "is there a token" (there is) and NOT "is the
 * write side protected" (it is — measured, 401). The plane is:
 *
 *     **WHAT DOES THE WORD "GET" BUY?**
 *
 * A GET is not a read-only operation. On this surface, GET also:
 *   - reads the WHOLE memory pool (list + per-key values),
 *   - reads the whole GRAPH (nodes carry `metadata.value` = the same payload),
 *   - reads the graph's EDGES (the relationships),
 *   - reads topic message logs — including PRIVATE topics (R522 measured
 *     that already; this round measures the *boundary*, not the privacy).
 *
 * ⇒ The method name is being used as an authorization decision, and HTTP
 * method semantics do not imply "this is safe to expose".
 *
 * ── WHAT IS PINNED HERE ───────────────────────────────────────────────────
 *
 * The repair is a PRODUCT decision (father-gated):
 *   - Should GET require a credential at all (i.e. is the hub a public
 *     read-only API by design)?
 *   - If yes, WHICH GETs stay open (`/health`, `/ready` are probe endpoints
 *     and probably must stay open for k8s)?
 *   - Should the REST surface carry a PRINCIPAL (so a private topic's log can
 *     be scoped to members)? — R522/R547 left this open.
 *
 * This suite is the DISCLOSURE, not the fix: a **defect-presence gate**, green
 * today, RED when the boundary is closed. Never mistake it for a regression
 * gate on the REST feature.
 *
 * ── POLARITY AND ARM ROLES ───────────────────────────────────────────────
 *
 * This suite asserts the DEFECT EXISTS. Two suites about one subject with
 * opposite polarity is fine (R512-14 / R461 arm G); ONE suite with two
 * polarities is not. Every arm below pins the OBSERVED (defective) behaviour.
 *
 * Every arm carries an explicit ROLE in its title, because the mutation matrix
 * reads roles to decide what a flip MEANS:
 *
 *   DEFECT-PIN     a boundary repair SHOULD flip it RED (the defect is caught)
 *   CONTROL        a repair MUST NOT flip it      (it is a stable fact)
 *   DISCRIMINATOR  flips under a FULL close, stays green under a PARTIAL one
 *                  (it tells the two repairs apart)
 *   NO-REPAIR-YET  measures "the repair has not landed" — it flips only when a
 *                  repair adds a reader/principal, not when one closes a gate
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

const TOKEN = 'r549-test-token';

describe('R549 — the REST GET authorization boundary', () => {
  const testDir = '/tmp/woclaw-r549-' + Date.now();
  let db: ClawDB;
  let wsServer: WSServer;
  let restServer: RestServer;
  let graph: GraphStore;
  let topics: ReturnType<WSServer['getTopicsManager']>;
  let port = 0;

  const cfg: any = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: `${testDir}/test.db` },
    authToken: TOKEN,
  };

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    topics = wsServer.getTopicsManager();
    graph = new GraphStore();
    restServer = new RestServer(cfg, db, topics, wsServer.getMemoryPool(), graph, wsServer);
    restServer.start();
    port = await restServer.whenListening();
  });

  afterEach(async () => {
    try { restServer?.close(); } catch { /* not started in every arm */ }
    try { wsServer?.close(); } catch { /* already closed */ }
    try { await db?.close(); } catch { /* already closed */ }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function seedMemory(): Promise<void> {
    // Write through the REAL MemoryPool so the REAL graph-sync half fires
    // (MemoryPool.write() -> graphStore.syncMemoryNode) -- that is what puts
    // the value into the graph's metadata.value, which is what arm 4 reads.
    const pool = wsServer.getMemoryPool();
    pool.graphStore = graph;
    await pool.write('r549:secret', 'R549_PRIVATE_VALUE', 'r549-seed', ['private-tag']);
    await pool.write('r549:public', 'R549_PUBLIC_VALUE', 'r549-seed', ['public-tag']);
  }

  function get(path: string, token?: string): Promise<{ status: number; body: string }> {
    return (async () => {
      const headers: Record<string, string> = {};
      if (token !== undefined) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
      return { status: res.status, body: await res.text() };
    })();
  }

  async function readSource(): Promise<string> {
    const fs = await import('fs');
    return fs.readFileSync(new URL('../src/rest_server.ts', import.meta.url), 'utf-8');
  }

  // ══ 0. CONTROL — the write side IS protected ═══════════════════════════
  it('0. CONTROL: the WRITE side is authenticated (401 without a credential)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'x', value: 'y' }),
    });
    expect(res.status).toBe(401);
  });

  // ══ 1. DEFECT-PIN — GET /memory returns the WHOLE pool anonymously ═════
  it('1. DEFECT-PIN: GET /memory with NO credential returns every memory key AND value', async () => {
    await seedMemory();
    const { status, body } = await get('/memory');
    expect(status).toBe(200);
    expect(body).toContain('r549:secret');
    expect(body).toContain('R549_PRIVATE_VALUE');
    expect(body).toContain('r549:public');
  });

  // ══ 2. DEFECT-PIN — the per-key read needs no credential ═══════════════
  it('2. DEFECT-PIN: GET /memory/:key with NO credential returns the value', async () => {
    await seedMemory();
    const { status, body } = await get('/memory/r549:secret');
    expect(status).toBe(200);
    expect(body).toContain('R549_PRIVATE_VALUE');
  });

  // ══ 3. DEFECT-PIN — the credential is DECORATIVE on GET ════════════════
  it('3. DEFECT-PIN: a GARBAGE credential reads exactly the same bytes as no credential', async () => {
    await seedMemory();
    const bare = await get('/memory/r549:secret');
    const garbage = await get('/memory/r549:secret', 'garbage-token-zzz');
    expect(garbage.status).toBe(bare.status);
    expect(garbage.body).toBe(bare.body);
  });

  // ══ 4. DEFECT-PIN — the graph is a SECOND copy of the same payload ═════
  it('4. DEFECT-PIN: GET /graph/nodes carries the memory VALUE in metadata.value — anonymously', async () => {
    await seedMemory();
    const { status, body } = await get('/graph/nodes');
    expect(status).toBe(200);
    expect(body).toContain('R549_PRIVATE_VALUE');
  });

  // ══ 5. DEFECT-PIN — the FULL-DUMP CHAIN works end to end ══════════════
  it('5. DEFECT-PIN: CHAIN — list the pool, then read every value, no credential at any step', async () => {
    await seedMemory();
    const list = await get('/memory');
    expect(list.status).toBe(200);
    const keys = JSON.parse(list.body).memory.map((m: any) => m.key);
    expect(keys).toContain('r549:secret');
    for (const k of keys) {
      const one = await get('/memory/' + encodeURIComponent(k));
      expect(one.status).toBe(200);
    }
  });

  // ══ 6. CONTROL — the scope guard's default is the widest scope ══════════
  // (Stable under every repair: it pins a fact about the SCOPE subsystem,
  //  not about the auth gate.  Its job is to prove the suite is not
  //  "everything flips".)
  it('6. CONTROL: omitting `scope` reads the WIDEST scope; the guard only narrows on request', async () => {
    await seedMemory();
    const bare = await get('/memory');
    const widest = await get('/memory?scope=all');
    expect(bare.body).toBe(widest.body);
  });

  // ══ 7. DEFECT-PIN — the exemption is not limited to probe endpoints ════
  it('7. DEFECT-PIN: the GET exemption reaches ordinary endpoints too (/agents is anonymous)', async () => {
    const { status, body } = await get('/agents');
    expect(status).toBe(200);
    expect(body).toContain('agents');
  });

  // ══ 8. CONTROL — the one hand-listed exception really is closed ════════
  it('8. CONTROL: /admin/token/status — the ONE hand-listed exception — IS closed', async () => {
    const { status } = await get('/admin/token/status');
    expect(status).toBe(401);
  });

  // ══ 9. DISCRIMINATOR — /health is a probe endpoint and must stay open ═══
  it('9. DISCRIMINATOR: /health is open (a k8s probe endpoint must stay open)', async () => {
    const { status } = await get('/health');
    expect(status).toBe(200);
  });

  // ══ 10. DEFECT-PIN — a 404 (not a 401) proves the gate was PASSED ═════
  it('10. DEFECT-PIN: a nonexistent key 404s — a 404, not a 401, proves the auth gate was passed', async () => {
    const { status } = await get('/memory/r549:does-not-exist');
    expect(status).toBe(404);
  });

  // ══ 11. CONTROL — the posture is ONE expression ═════════════════════════
  it('11. CONTROL: the posture is ONE expression — exactly one `requiresAuth` decision', async () => {
    const src = await readSource();
    const lines = src.split('\n').filter((l: string) => l.includes('const requiresAuth'));
    expect(lines.length).toBe(1);
  });

  // ══ 12. NO-REPAIR-YET — the read handler takes NO identity ═════════════
  it('12. NO-REPAIR-YET: the memory READ handler takes no principal — nothing to scope against', async () => {
    // NOTE: Function.length stops counting at the FIRST parameter with a
    // default value, so `handleMemoryGet(res, key, scope = 'all')` reports
    // length 2, not 3.  The property under test is "no identity parameter",
    // so we read the SOURCE SIGNATURE instead of the arity.
    const src = await readSource();
    const sig = src.split('\n').find((l: string) =>
      l.includes('handleMemoryGet(') && l.includes('private'));
    expect(sig).toBeDefined();
    // (res, key, scope) — no agentId, no token, no principal of any kind.
    expect(sig).not.toMatch(/agentId|token|principal|identity|auth/i);
  });
});
