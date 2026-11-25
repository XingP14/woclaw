/**
 * R557 — **the route-offset plane: the router slices the path at a number it
 * hand-computed, and nothing checks that number.**
 *
 * ── THE PLANE ─────────────────────────────────────────────────────────────
 *
 * Every REST route that takes a parameter FROM THE PATH does it with a
 * hand-written magic number:
 *
 *     } else if (path.startsWith('/graph/edges/') && method === 'DELETE') {
 *       const edgeId = decodeURIComponent(path.slice(14));   // ← 14
 *
 * The contract is `sliceAt === prefix.length`. There is no
 * `path.replace(prefix, '')`, no `path.substring(prefix.length)` — the
 * magic number IS the contract, and **nothing in the tree checks it**.
 *
 * This plane is NOT the same as R532's class B (which was about *numeric*
 * parameters). R532 measured the **numeric** parameter layer. This round
 * measures the **path-prefix** layer: the offset at which the router stops
 * being the prefix.
 *
 * ── WHAT THIS ROUND FOUND THAT R532 DID NOT ───────────────────────────────
 *
 * R532 (2026-11-21) found **two** misaligned sites and PINNED that count:
 *
 *     expect(misaligned.length).toBe(2);
 *     expect(misaligned.map(s => s.prefix).sort())
 *       .toEqual(['/graph/edges/', '/graph/paths/']);
 *
 * That count was **wrong**, and it was wrong because of the derivation
 * itself: R532's `derivePrefixSites()` scans only the **10 lines following**
 * each `path.startsWith(prefix)` guard for the slice that belongs to it:
 *
 *     for (let j = i; j < Math.min(lines.length, i + 10); j++) {
 *
 * A route whose slice sits further than 10 lines after its guard is **not
 * derived at all** — it is silently absent from the subject set, and then
 * the suite's own `toBe(2)` pins the **truncated** count as if it were the
 * truth.
 *
 * ⇒ **F1 (the headline): the census that was supposed to find ALL
 * misaligned routes found only the two whose defect was ALREADY KNOWN.**
 * That is the "recorded at one layer only" shape (R523) with a new
 * mechanism: the subject set was **narrower than reality**, and the
 * assertion that should have caught it instead **froze** it.
 *
 * Measured: the truth is **4** misaligned sites, not 2 (R557's own audit
 * below derives them from the source with no window at all). The two R532
 * already knew are `/graph/edges/` and `/graph/paths/`. The two it MISSED
 * are `/streams/` and `/sessions/`.
 *
 * ⇒ **F2: a suite that pins a COUNT of defects freezes the count.** This is
 * R438 (stated number vs unbound number) in a new garment: `toBe(2)` is a
 * *stated number*, and here it is *bound* — but bound to a **truncated
 * derivation**, so it is a true statement about a false subject set.
 *
 * ── WHAT IS *NOT* CLAIMED ─────────────────────────────────────────────────
 *
 *   - This suite ships **ZERO production changes**. Whether an off-by-one
 *     route should be fixed, and how, is a BEHAVIOUR decision. But note the
 *     shape of two of them (below): one route cannot be reached at all, and
 *     one route acts on an id **the URL never carried**. Those are facts,
 *     not opinions.
 *   - The `/memory/recall` and `/delegations` entries in an unbounded
 *     nearest-guard derivation are **artefacts of the derivation**, not
 *     defects: `/memory/recall` has no path slice of its own (it uses a
 *     query parameter), and `/delegations` has no path slice either (it uses
 *     query parameters). The suite derives the subject set the way the
 *     ROUTER does — by following the branch, not by proximity — so those
 *     two never enter the set. See arm A0's derivation note.
 *
 * ── POLARITY ──────────────────────────────────────────────────────────────
 *
 * This suite asserts the DEFECT EXISTS. Every arm pins the OBSERVED
 * (defective) behaviour, so a repair turns it RED and the repair becomes a
 * deliberate, reviewed act. Do not mistake it for a regression gate.
 *
 * Arm roles are in each `it()` title, because the mutation matrix reads
 * roles to decide what a flip MEANS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import { WebSocket } from 'ws';
import type { Config } from '../src/types.js';

const REST_TS = new URL('../src/rest_server.ts', import.meta.url).pathname;
const TOKEN = 'r557-token-0123456789abcdef';

const CFG: Config = {
  port: 0,
  restPort: 0,
  host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r557-suite',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r557-suite/test.db' },
  authToken: TOKEN,
};

/* ══════════════════════════════════════════════════════════════════════════
   A. THE DERIVATION — the subject set, derived, NOT hand-listed
   ══════════════════════════════════════════════════════════════════════════ */

interface PrefixSite {
  /** the guard literal, e.g. '/graph/edges/' */
  prefix: string;
  /** the hand-written slice offset */
  sliceAt: number;
  /** the line the slice actually lives on */
  sliceLine: number;
  /** TRUE when sliceAt === prefix.length */
  aligned: boolean;
}

/**
 * Derive the (guard, slice) pairs the way the ROUTER does — by walking
 * FORWARD from each `path.startsWith(prefix)` guard to the first `path.slice(n)`
 * that belongs to THAT branch, with **no fixed window**.
 *
 * Two exclusions matter, and both are facts about the router rather than
 * heuristics:
 *
 *  1. `/memory/recall` has **no path slice of its own** — it reads `q`,
 *     `intent`, `limit` from the QUERY string. The first `path.slice` after
 *     it belongs to the NEXT branch (`/memory/tags/`). So a branch is only
 *     a subject if the slice is reached **without crossing another guard**.
 *
 *  2. `/delegations` likewise has **no path slice** — it reads `agentId`,
 *     `fromAgent`, `toAgent`, `status` from the query string, and its
 *     sub-routes are matched by `path ===` equality, not by slicing.
 *
 * ⇒ The rule is therefore: **a guard owns a slice only if no other guard
 * intervenes.** That is the router's own control flow, so the derivation
 * cannot pick up a slice that belongs to a different branch.
 */
function derivePrefixSites(): PrefixSite[] {
  const lines = readFileSync(REST_TS, 'utf8').split('\n');
  const sites: PrefixSite[] = [];
  for (let i = 0; i < lines.length; i++) {
    const g = lines[i].match(/path\.startsWith\('([^']+)'\)/);
    if (!g) continue;
    const prefix = g[1];
    // walk forward to the first slice, stopping at the next guard
    for (let j = i; j < lines.length; j++) {
      if (j > i && /path\.startsWith\('([^']+)'\)/.test(lines[j])) break; // next branch owns it
      const s = lines[j].match(/path\.slice\((\d+)\)/);
      if (!s) continue;
      const sliceAt = Number(s[1]);
      sites.push({ prefix, sliceAt, sliceLine: j + 1, aligned: sliceAt === prefix.length });
      break;
    }
  }
  return sites;
}

const PREFIX_SITES = derivePrefixSites();
const MISALIGNED = PREFIX_SITES.filter(s => !s.aligned);

/* ══════════════════════════════════════════════════════════════════════════
   test scaffolding — a REAL RestServer, REAL ClawDB, REAL GraphStore
   ══════════════════════════════════════════════════════════════════════════ */

describe('R557 — the route-offset plane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r557-'));
  let db: ClawDB;
  let wsServer: WSServer;
  let rest: RestServer;
  let graph: GraphStore;
  let port: number;
  let wsPort: number;

  beforeEach(async () => {
    const cfg: Config = { ...CFG, dataDir: dir, storage: { type: 'sqlite', sqlitePath: join(dir, 'test.db') } };
    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    graph = new GraphStore();
    const mem = wsServer.getMemoryPool();
    mem.graphStore = graph;
    rest = new RestServer(cfg, db, wsServer.getTopicsManager(), mem, graph, wsServer);
    rest.start();
    port = await rest.whenListening();
    wsPort = await wsServer.whenListening();
  });

  afterEach(async () => {
    try { rest?.close(); } catch { /* not started in every arm */ }
    try { wsServer?.close(); } catch { /* already closed */ }
    try { await db?.close(); } catch { /* already closed */ }
  });

  async function get(p: string, token?: string): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers });
    return { status: res.status, body: await res.text() };
  }

  async function del(p: string): Promise<{ status: number; body: string }> {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` },
    });
    return { status: res.status, body: await res.text() };
  }

  /* ────────────────────────────────────────────────────────────────────────
     0. CONTROL / DERIVATION
     ──────────────────────────────────────────────────────────────────────── */

  it('0. CONTROL — the derivation is non-vacuous and finds the real sites', () => {
    // the derivation must find the guard/slice pairs at all
    expect(PREFIX_SITES.length).toBeGreaterThanOrEqual(8);

    // it must find BOTH aligned and misaligned sites, else the arms below
    // are vacuous in one direction or the other
    const aligned = PREFIX_SITES.filter(s => s.aligned);
    expect(aligned.length).toBeGreaterThanOrEqual(4);
    expect(MISALIGNED.length).toBeGreaterThanOrEqual(2);

    // every misaligned site drops or adds exactly ONE character — a site
    // that dropped a different number would be a DIFFERENT defect
    for (const s of MISALIGNED) {
      expect(Math.abs(s.sliceAt - s.prefix.length)).toBe(1);
    }
  });

  it('0b. DEFECT-PIN — the misaligned set is FOUR, not the TWO R532 pinned', () => {
    // This arm is the round's headline. R532's arm A0 says:
    //     expect(misaligned.length).toBe(2);
    //     expect(misaligned.map(s => s.prefix).sort())
    //       .toEqual(['/graph/edges/', '/graph/paths/']);
    // R532's derivation could only ever FIND those two, because it scans
    // just 10 lines past each guard.
    //
    // The truth: FOUR routes are misaligned. Two were already known; the
    // other two were invisible to a census whose own assertion froze the
    // truncated count.
    expect(MISALIGNED.map(s => s.prefix).sort()).toEqual([
      '/graph/edges/',
      '/graph/paths/',
      '/sessions/',
      '/streams/',
    ]);

    // And the two R532 knew are still there — this suite does not claim
    // they are new, only that the set was incomplete.
    const known = MISALIGNED.filter(s => s.prefix === '/graph/edges/' || s.prefix === '/graph/paths/');
    expect(known.length).toBe(2);
  });

  it('0c. DEFECT-PIN — R532\'s 10-line derivation window is what truncated the set', () => {
    // Reproduce R532's EXACT derivation (same regexes, same window) and
    // show it finds a SMALLER subject set. Same rule, less reach.
    const lines = readFileSync(REST_TS, 'utf8').split('\n');
    const r532: { prefix: string; sliceAt: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/path\.startsWith\('([^']+)'\)/);
      if (!m) continue;
      for (let j = i; j < Math.min(lines.length, i + 10); j++) {
        const s = lines[j].match(/path\.slice\((\d+)\)/);
        if (!s) continue;
        r532.push({ prefix: m[1], sliceAt: Number(s[1]) });
        break;
      }
    }
    const r532Mis = r532.filter(s => s.sliceAt !== s.prefix.length);
    const oursMis = MISALIGNED;

    // R532's windowed derivation sees exactly two; ours sees four.
    expect(r532Mis.length).toBe(2);
    expect(r532Mis.map(s => s.prefix).sort()).toEqual(['/graph/edges/', '/graph/paths/']);
    expect(oursMis.length).toBe(4);

    // and the ones it missed are exactly the ones whose slice sits more
    // than 10 lines after their guard
    const missed = oursMis.filter(s => !r532Mis.some(r => r.prefix === s.prefix));
    expect(missed.map(s => s.prefix).sort()).toEqual(['/sessions/', '/streams/']);
  });

  /* ────────────────────────────────────────────────────────────────────────
     1. /graph/edges/ — slice(14) for a 13-char prefix
        ⇒ the extracted id is the requested id MINUS ITS FIRST CHARACTER
        ⇒ a URL that does NOT contain the edge's id still deletes it
     ──────────────────────────────────────────────────────────────────────── */

  it('1. DEFECT-PIN — DELETE /graph/edges/:id deletes an id that is NOT in the URL', async () => {
    const n1 = graph.addNode({ type: 'memory', label: 'n1', metadata: {} });
    const n2 = graph.addNode({ type: 'memory', label: 'n2', metadata: {} });
    const edge = graph.addEdge({ source: n1.id, target: n2.id, type: 'semantic', metadata: {} });
    expect(graph.getEdge(edge.id)).toBeDefined();

    // The URL carries "Z" + the id. The router slices 14 chars off
    // "/graph/edges/" (13 chars), so it extracts the id WITHOUT its first
    // character — i.e. the REAL id — and deletes that.
    const spoof = `Z${edge.id}`;
    // the URL does not EQUAL the id, and the segment the router extracts
    // from it is the real id:
    expect(spoof).not.toBe(edge.id);
    expect(spoof.slice(1)).toBe(edge.id);
    const res = await del(`/graph/edges/${spoof}`);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).deleted).toBe(edge.id); // deleted the REAL edge
    expect(graph.getEdge(edge.id)).toBeUndefined();     // and it is gone
  });

  it('1b. CONTROL — the HONEST url for the same edge answers 404', async () => {
    const n1 = graph.addNode({ type: 'memory', label: 'n1', metadata: {} });
    const n2 = graph.addNode({ type: 'memory', label: 'n2', metadata: {} });
    const edge = graph.addEdge({ source: n1.id, target: n2.id, type: 'semantic', metadata: {} });

    const res = await del(`/graph/edges/${edge.id}`);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Edge not found');
    // the edge survives — the route could not address it
    expect(graph.getEdge(edge.id)).toBeDefined();
  });

  it('1c. DEFECT-PIN — the "correct" edge handler lives in a DIFFERENT METHOD that graph paths never enter', () => {
    // rest_server.ts:1051 contains a second, CORRECT extraction:
    //     const edgeMatch = path.match(/^\/graph\/edges\/(.+)$/);
    //     if (edgeMatch && method === 'DELETE') { const id = edgeMatch[1]; ...
    //
    // R532 (2026-11-21) described this as "the correct handler is DEAD CODE,
    // shadowed by the broken one, because the broken `startsWith` branch
    // comes FIRST in the if/else chain and RETURNS".
    //
    // ❌ THAT IS WRONG, and R557 measured why. The `edgeMatch` block is not
    // a sibling branch of the router's if/else chain AT ALL — it lives
    // INSIDE `handleDelegations` (a method that spans L829–L1078), and the
    // router calls that method ONLY for paths matching '/delegations'.
    // For a '/graph/edges/...' path, `handleDelegations` is NEVER ENTERED,
    // so its `edgeMatch` extraction is unreachable — not shadowed.
    //
    // The two claims differ in what they imply about the repair:
    //   - "shadowed"  ⇒ the fix is to DELETE the broken branch (the correct
    //     one is already there, just unreachable by ordering);
    //   - "different method" ⇒ the fix is to WRITE a correct extraction in
    //     the router's own chain (nothing correct exists there today).
    //
    // This arm pins the STRUCTURE, so the distinction cannot drift.
    const src = readFileSync(REST_TS, 'utf8');
    const lines = src.split('\n');

    // the delegations method's header line
    const delegStart = lines.findIndex(l => /private handleDelegations\(/.test(l));
    expect(delegStart).toBeGreaterThan(-1);

    // the edgeMatch line
    const edgeMatchLine = lines.findIndex(l => /const edgeMatch = path\.match\(\/\^\\\/graph\\\/edges/.test(l));
    expect(edgeMatchLine).toBeGreaterThan(-1);

    // the delegations method's closing brace: the first line at exactly two
    // spaces of indent that closes the method, after edgeMatchLine
    let delegEnd = -1;
    for (let i = edgeMatchLine; i < lines.length; i++) {
      if (lines[i] === '  }') { delegEnd = i; break; }
    }
    expect(delegEnd).toBeGreaterThan(edgeMatchLine);

    // ⇒ the edgeMatch block IS inside handleDelegations
    expect(edgeMatchLine).toBeGreaterThan(delegStart);
    expect(edgeMatchLine).toBeLessThan(delegEnd);

    // and the router's OWN chain is a different place entirely.
    // (indexOf returns a CHARACTER offset; delegStart is a LINE index —
    //  comparing them directly is my own bug, caught by the arm.)
    const routerChainLine = lines.findIndex(l => l.includes("path.startsWith('/graph/edges/')"));
    expect(routerChainLine).toBeGreaterThan(-1);
    expect(routerChainLine).toBeLessThan(delegStart);
  });

  /* ────────────────────────────────────────────────────────────────────────
     2. /graph/paths/ — slice(14) for a 13-char prefix
        ⇒ the honest url 404s; the SPOOFED url returns the path
     ──────────────────────────────────────────────────────────────────────── */

  it('2. DEFECT-PIN — GET /graph/paths/:from/:to 404s for the honest url and 200s for a spoofed one', async () => {
    const n1 = graph.addNode({ type: 'memory', label: 'p1', metadata: {} });
    const n2 = graph.addNode({ type: 'memory', label: 'p2', metadata: {} });
    graph.addEdge({ source: n1.id, target: n2.id, type: 'semantic', metadata: {} });

    const honest = await get(`/graph/paths/${n1.id}/${n2.id}`);
    expect(honest.status).toBe(404);
    expect(JSON.parse(honest.body).error).toBe('No path found');

    // The route extracts the `from` id with its first character removed.
    // Prefixing one character to the URL restores the real id.
    const spoof = await get(`/graph/paths/Z${n1.id}/${n2.id}`);
    expect(spoof.status).toBe(200);
    expect(JSON.parse(spoof.body).path.from).toBe(n1.id);
  });

  /* ────────────────────────────────────────────────────────────────────────
     3. /streams/ — slice(8) for a 9-char prefix
        ⇒ the reader queries "/topic"; the writer stored "topic"
        ⇒ THE TWO PLANES DISAGREE ABOUT THE NAME OF THE SAME TOPIC
     ──────────────────────────────────────────────────────────────────────── */

  it('3. DEFECT-PIN — a WS-published stream is unreadable through REST, and REST reports the WRONG topic name', async () => {
    const sock = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=a1&token=${TOKEN}`);
    await new Promise<void>((res, rej) => { sock.once('open', () => res()); sock.once('error', rej); });

    sock.send(JSON.stringify({
      type: 'publish-stream',
      topic: 'mytopic',
      stream: {
        run_id: 'run-cross-1',
        schema_version: '1.0',
        started_at: 1700000000000,
        events: [{ event: 'start', schema_version: '1.0', agent_id: 'a1', topic: 'mytopic', ts: 1700000000000 }],
      },
    }));
    // R482-10: a FIXED SLEEP on a network arm is a coin toss — it flips
    // across rounds on IDENTICAL source. So we POLL for the row instead.
    let rows: Awaited<ReturnType<typeof db.getStreamsByTopic>> = [];
    for (let i = 0; i < 100 && rows.length === 0; i++) {
      rows = await db.getStreamsByTopic('mytopic');
      if (rows.length === 0) await new Promise(r => setTimeout(r, 20));
    }

    // the WS plane stored it under the topic the agent actually sent
    expect(rows.length).toBe(1);
    expect(rows[0].runId).toBe('run-cross-1');

    // the REST plane looks it up under "/mytopic" (slice 8 of a 9-char prefix)
    const slashRows = await db.getStreamsByTopic('/mytopic');
    expect(slashRows.length).toBe(0);

    // and the REST response CONFIRMS the wrong name — the operator is told
    // the topic is "/mytopic", which is not a topic that exists
    const res = await get('/streams/mytopic', TOKEN);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.topic).toBe('/mytopic');   // ← the leading slash
    expect(body.count).toBe(0);           // ← and it found nothing

    sock.close();
  });

  it('3b. CONTROL — the REST route CAN read a stream whose topic literally begins with a slash', async () => {
    // The mirror of arm 3: because the reader adds the slash, a topic
    // literally named "/x" IS reachable, while "x" is not. This is what
    // makes the defect a *renaming*, not a blanket failure.
    await db.saveStream('run-slash', '/mytopic', 'a1', '1.0', 1, '[]', null);
    const res = await get('/streams/mytopic', TOKEN);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(1);
    expect(body.runs[0].runId).toBe('run-slash');
  });

  /* ────────────────────────────────────────────────────────────────────────
     4. /sessions/ — slice(9) for a 10-char prefix
        ⇒ every session read/write addresses "/id"
        ⇒ AND the sub-route /sessions/search is unreachable
     ──────────────────────────────────────────────────────────────────────── */

  it('4. DEFECT-PIN — the whole /sessions/:id surface addresses an id with a leading slash', async () => {
    const created = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: 'sess-1', title: 'hello' }),
    });
    expect(created.status).toBe(201);

    // GET the session by its real id → 404
    const g = await get('/sessions/sess-1');
    expect(g.status).toBe(404);
    expect(JSON.parse(g.body).error).toBe('Session not found');

    // PUT it by its real id → the error NAMES the id it actually addressed
    const put = await fetch(`http://127.0.0.1:${port}/sessions/sess-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ title: 'PATCHED' }),
    });
    const putBody = await put.text();
    expect(put.status).toBe(400);
    expect(JSON.parse(putBody).error).toBe('Session not found: /sess-1');

    // the session still exists, untouched, under its real id
    const list = await get('/sessions', TOKEN);
    expect(JSON.parse(list.body).count).toBe(1);
    expect(JSON.parse(list.body).sessions[0].id).toBe('sess-1');
    // and the write did NOT land anywhere: the addressed id "/sess-1" does
    // not exist in the store
    const rows = await db.getSession('/sess-1');
    expect(rows).toBeUndefined();
    expect(await db.getSession('sess-1')).toBeDefined();
  });

  it('4b. DEFECT-PIN — GET /sessions/search is unreachable (the sub-route id is "/search")', async () => {
    const res = await get('/sessions/search?q=anything', TOKEN);
    // the route extracted "/search", which is not "search", so it fell
    // through to handleSessionGet and answered "Session not found"
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Session not found');
  });

  it('4c. CONTROL — the collection route itself is unaffected', async () => {
    const res = await get('/sessions', TOKEN);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('sessions');
  });

  /* ────────────────────────────────────────────────────────────────────────
     5. THE ALIGNED SIBLINGS — the control that proves this is not a hunt
     ──────────────────────────────────────────────────────────────────────── */

  it('5. CONTROL — the ALIGNED sibling routes work, in the SAME file, four lines apart', async () => {
    // '/graph/nodes/' slices 13 for a 13-char prefix
    const n = graph.addNode({ type: 'memory', label: 'ctrl', metadata: { value: 'V' } });
    const nodeRes = await get(`/graph/nodes/${n.id}`);
    expect(nodeRes.status).toBe(200);
    expect(JSON.parse(nodeRes.body).node.id).toBe(n.id);

    // '/memory/tags/' slices 13 for a 13-char prefix
    const mem = wsServer.getMemoryPool();
    await mem.write('r557:tagged', 'VALUE', 'r557-seed', ['r557tag']);
    const tagRes = await get('/memory/tags/r557tag');
    expect(tagRes.status).toBe(200);
    expect(JSON.parse(tagRes.body).count).toBeGreaterThan(0);
  });

  /* ────────────────────────────────────────────────────────────────────────
     6. THE SHAPE — the router does not use a self-describing extraction
     ──────────────────────────────────────────────────────────────────────── */

  it('6. DEFECT-PIN — the router computes no prefix length; every offset is a literal', () => {
    const src = readFileSync(REST_TS, 'utf8');
    // there is no `prefix.length` anywhere near the path slices
    expect(src).not.toMatch(/slice\(\s*\w*[Pp]refix\.length\s*\)/);
    expect(src).not.toMatch(/slice\(\s*['"]\/[^'"]*['"]\.length\s*\)/);
    // and the four misaligned offsets are all bare integer literals
    for (const s of MISALIGNED) {
      expect(s.sliceAt).toBeGreaterThan(0);
      expect(Number.isInteger(s.sliceAt)).toBe(true);
    }
  });
});
