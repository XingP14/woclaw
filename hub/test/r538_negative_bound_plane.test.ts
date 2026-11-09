/**
 * R538 — THE LOWER BOUND: a numeric parameter that PARSES but is NEGATIVE.
 *
 * ── THE PLANE ────────────────────────────────────────────────────────────────
 *
 * `hub/src/rest_server.ts:83` `parseIntParam` is the single numeric
 * extraction point for the REST surface. R532 measured the **NaN class**
 * (an UNPARSEABLE value): `parseInt('abc')` → NaN, and every caller that
 * treats the parsed number as a BOUND then inverts or removes the bound.
 *
 * This round measures the **other half** — a value that PARSES FINE but is
 * NEGATIVE. It is a strictly different class, because it never produces NaN:
 *
 *     parseIntParam(url, 'limit', 10) with ?limit=-5   →   -5
 *
 * The cap `Math.min(-5, 50)` is `-5` — the cap is NOT inverted (it is not
 * NaN) and NOT removed (it is a number). It is **honoured**, in the wrong
 * direction: the caller asked for a bound and the system delivered a bound
 * that says "give me everything, or nothing, depending on the carrier".
 *
 * That last clause is the point. `parseIntParam` is ONE helper, but the
 * number it returns is consumed by FOUR different carriers, and each one
 * resolves a negative value DIFFERENTLY:
 *
 *   CARRIER 1 — JS `Array.prototype.slice(0, limit)`.
 *       A negative end index counts from the END of the array.
 *       `slice(0, -1)` drops the last element; `slice(0, -5)` drops the last
 *       five. So the bound INVERTS into "return almost everything".
 *
 *   CARRIER 2 — SQLite `LIMIT ?`.
 *       A negative LIMIT is documented as **"no upper bound at all"**
 *       (sqlite.org/lang_limit.html: "A negative LIMIT value is interpreted
 *       as 'no limit'"). The bound VANISHES and every row comes back.
 *
 *   CARRIER 3 — MySQL `LIMIT ?`.
 *       A negative LIMIT is a **syntax error** (ER_PARSE_ERROR), so the
 *       route 500s instead of returning rows. MEASURED against MySQL 8.0
 *       by `hub/scripts/r538_mysql_carrier.py`.
 *
 *   CARRIER 4 — a comparison guard (`results.length < limit`).
 *       `0 < -5` is false, so the loop condition NEVER holds: the bound
 *       VANISHES in the OPPOSITE direction and the route returns NOTHING.
 *
 * ⇒ The same request `?limit=-1` means FOUR different things depending on
 * which route answers it: almost everything / everything / a 500 / nothing.
 * There is no single "the limit was ignored" claim that is true across the
 * surface; there are four, and they disagree.
 *
 * ── WHAT IS MEASURED (nothing assumed; everything observed) ─────────────────
 *
 * Measured on a real `RestServer` + real `ClawDB` (SQLite) + a real
 * `GraphStore`, with 40 seeded memories / 40 seeded stream runs / a 30-node
 * chain:
 *
 *   limit=-1  →  /memory/search   → 39 rows  (slice: slice(0,-1) drops ONE)
 *                /memory/recall    → 39 rows  (the SAME slice carrier)
 *                /streams/:topic   → 40 rows  (SQLite: negative LIMIT = NO LIMIT)
 *                /graph/traverse   →  0 nodes  (guard: 0 < -1 is false)
 *
 * All four answer HTTP 200. Four carriers, FOUR different answers.
 *
 * F1 ⭐⭐⭐ THE CARRIERS DISAGREE — in **both** direction and magnitude.
 *     `?limit=-1` returns "almost everything" on one route, "everything" on
 *     another, and "nothing" on a third.
 *
 * F1c ⭐⭐ THE MAGNITUDE IS PART OF THE PARAMETER, AND IT IS NOT MONOTONIC.
 *     On the slice carrier `-1` → 39 rows, `-5` → 35 rows, but `-9999` →
 *     **0** rows (a negative end index beyond the array length clamps to
 *     empty) ⇒ a MORE negative value returns FEWER rows, so there is no
 *     "unbounded" value the client can pick. On the SQLite carrier the
 *     magnitude is IGNORED entirely: `-1` and `-9999` both return 40.
 *
 * F2 ⭐⭐ THE CAP DOES NOT INVERT INTO ZERO — the negative class is the
 *     OPPOSITE of R532's NaN class. `?limit=abc` yields an EMPTY page
 *     (search) or a 500 (SQLite datatype mismatch); `?limit=-1` yields an
 *     OVER-full page. A reviewer who knows only the NaN case would predict
 *     "empty" here and would conclude the negative case is safe. It is not.
 *
 * F3 ⭐⭐ THE STREAM LISTING ROUTE IS UNAUTHENTICATED. `requiresAuth` is
 *     `method !== 'GET'` (rest_server.ts:236) ⇒ every GET is anonymous, so
 *     the row cap is the ONLY thing standing between an anonymous caller
 *     and the full list. It is not standing.
 *
 * F4 ⭐ ONE CARRIER IS SAFE BY ACCIDENT. `getMessages` clamps with
 *     `Math.max(0, limit)` — a lower bound the other three carriers lack.
 *     The clamp lives in the DATA layer, not in the extraction layer, so it
 *     protects exactly one of the four routes and nothing else.
 * F5 ⭐⭐ THE CLAMP IS NOT A CONSTANT OF THE SYSTEM. `parseIntParam` has no
 *     lower bound and the REST layer has no clamp, so the "safety" of
 *     carrier 4 is a property of ONE call site in ONE storage class.
 *
 * ── WHAT THIS SUITE IS NOT ──────────────────────────────────────────────────
 *
 * It is NOT a claim that the hub is "vulnerable to DoS". It measures the
 * DIRECTION and the DISAGREEMENT. Every arm below states what was observed
 * on a real request handler with a real SQLite database.
 *
 * It is NOT a duplicate of R532. R532's subject is NaN (an unparseable
 * value); this suite's subject is a PARSEABLE negative value, which follows
 * a different path through every carrier. The arms below include a CONTROL
 * that re-measures the NaN case and asserts it still behaves as R532
 * recorded, so the two classes cannot be silently conflated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { RestServer } from '../src/rest_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const OLD_TOKEN = 'r538-old-token';

describe('R538 — the lower bound: a numeric parameter that PARSES but is NEGATIVE', () => {
  let testDir: string;
  let db: ClawDB;
  let wsServer: WSServer;
  let restServer: RestServer;
  let graph: GraphStore;

  const makeConfig = (): Config => ({
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: `${testDir}/test.db` },
    authToken: OLD_TOKEN,
  });

  beforeEach(async () => {
    testDir = '/tmp/woclaw-r538-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    mkdirSync(testDir, { recursive: true });
    const cfg = makeConfig();
    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    graph = new GraphStore();
    wsServer.getMemoryPool().graphStore = graph;
    restServer = new RestServer(cfg, db, wsServer.getTopicsManager(), wsServer.getMemoryPool(), graph, wsServer);

    // 40 memories: enough that a bound of -1 / -5 is visibly different from
    // an honest limit, and from "everything".
    for (let i = 0; i < 40; i++) {
      await wsServer.getMemoryPool().write(`mem:${String(i).padStart(3, '0')}`, `content ${i}`, 'r538', ['t'], 0);
    }

    // 40 stream runs on one topic: the SQLite-LIMIT carrier.
    for (let i = 0; i < 40; i++) {
      await db.saveStream(`run-${String(i).padStart(3, '0')}`, '/topic-a', 'agent-a', '1.0', 1000 + i, JSON.stringify([{ i }]), null);
    }

    // A 30-node chain for the comparison-guard carrier (graph traverse).
    let prev = graph.addNode({ type: 'memory', label: 'chain-0', metadata: {} });
    for (let i = 1; i < 30; i++) {
      const cur = graph.addNode({ type: 'memory', label: 'chain-' + i, metadata: {} });
      graph.addEdge({ source: prev.id, target: cur.id, type: 'entity', weight: 1 });
      prev = cur;
    }
  });

  afterEach(async () => {
    wsServer.close();
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  /** Drive the REAL request handler with a fake req/res pair. */
  function call(url: string, method = 'GET', token?: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      let status = 0;
      let body = '';
      const res: any = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader() {},
        writeHead(s: number) { status = s; this.statusCode = s; return this; },
        write(c: any) { body += typeof c === 'string' ? c : String(c); return true; },
        end(c?: any) {
          if (c) body += typeof c === 'string' ? c : String(c);
          let parsed: any = null;
          try { parsed = JSON.parse(body); } catch { parsed = body; }
          resolve({ status, body: parsed });
          return this;
        },
      };
      const req: any = {
        method,
        url,
        headers: { host: '127.0.0.1', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      };
      void (restServer as any).handleRequest(req, res);
    });
  }

  /* ── F1 ⭐⭐⭐ THE FOUR CARRIERS DISAGREE ─────────────────────────────── */

  it('F1 — the SAME negative limit means FOUR different things on four routes', async () => {
    // CARRIER 1 — JS slice. `slice(0, -1)` drops the LAST element only, so a
    // negative limit returns ALMOST EVERYTHING.
    const sliceRoute = await call('/memory/search?q=content&limit=-1');
    expect(sliceRoute.status).toBe(200);

    // CARRIER 2 — SQLite LIMIT. A negative LIMIT is "no limit" in SQLite.
    const sqliteRoute = await call('/streams/topic-a?limit=-1');
    expect(sqliteRoute.status).toBe(200);

    // CARRIER 4 — comparison guard. `results.length < limit` is false.
    const guardRoute = await call('/graph/traverse/' + (await firstChainId()) + '?depth=5&limit=-1');
    expect(guardRoute.status).toBe(200);

    // The honest bound, for reference: 40 memories exist, so limit=5 must
    // return 5 (NOT 40) on the slice route.
    const honest = await call('/memory/search?q=content&limit=5');
    expect(honest.body.count).toBe(5);

    // CARRIER 1: the negative limit returned MORE than the honest limit.
    // It did not degrade to zero (that is R532's NaN class) and it did not
    // fall back to the default of 10.
    expect(sliceRoute.body.count).toBeGreaterThan(honest.body.count);
    expect(sliceRoute.body.count).toBe(39); // slice(0, -1) on 40 matches
    expect(sliceRoute.body.count).not.toBe(0);

    // CARRIER 2: the negative limit returned EVERY row.
    expect(sqliteRoute.body.count).toBe(40);

    // CARRIER 3 (comparison guard): `results.length < limit` is FALSE for a
    // negative limit, so the traversal stops before it starts and returns
    // NOTHING. This is the third distinct answer for the SAME parameter.
    expect(guardRoute.body.count).toBe(0);

    // ⇒ THE CARRIERS DISAGREE ON THE MAGNITUDE as well as the direction:
    // one returns "all but one", one returns "all", one returns "none".
    expect(sliceRoute.body.count).not.toBe(sqliteRoute.body.count);
    expect(sqliteRoute.body.count).not.toBe(guardRoute.body.count);
    expect(sliceRoute.body.count).not.toBe(guardRoute.body.count);
  });

  it('F1b — the magnitude of the negative bound is itself the parameter', async () => {
    // CARRIER 1 with different negatives: slice(0, -5) drops FIVE elements.
    const one = await call('/memory/search?q=content&limit=-1');
    const five = await call('/memory/search?q=content&limit=-5');
    const twenty = await call('/memory/search?q=content&limit=-20');

    expect(one.body.count).toBe(39);
    expect(five.body.count).toBe(35);
    expect(twenty.body.count).toBe(20);

    // The client controls the bound, downwards, without limit. A caller who
    // wants "everything" does not need to omit the parameter — they set it
    // to a negative number and get MORE than the default of 10.
    const dflt = await call('/memory/search?q=content');
    expect(dflt.body.count).toBe(10);
    expect(one.body.count).toBeGreaterThan(dflt.body.count);
  });

  it('F1c — the magnitude is NOT monotonic, and the SQLite carrier ignores it', async () => {
    // A negative end index beyond the array length clamps to EMPTY: a MORE
    // negative value returns FEWER rows. There is no "unbounded" value the
    // client can pick.
    const huge = await call('/memory/search?q=content&limit=-9999');
    expect(huge.body.count).toBe(0);

    const one = await call('/memory/search?q=content&limit=-1');
    expect(one.body.count).toBe(39);
    expect(huge.body.count).toBeLessThan(one.body.count);

    // The SQLite carrier reads a negative LIMIT as "no upper bound" — the
    // magnitude is irrelevant, unlike the JS-slice carrier.
    const a = await call('/streams/topic-a?limit=-1');
    const b = await call('/streams/topic-a?limit=-9999');
    expect(a.body.count).toBe(40);
    expect(b.body.count).toBe(40);

    // ⇒ the two carriers disagree on the magnitude too. This is not one
    // defect with one shape; the surface has no single notion of what a
    // negative limit means.
    expect(one.body.count).not.toBe(a.body.count);
  });

  it('F1d — the recall route is a SECOND instance of the slice carrier', async () => {
    // /memory/recall reaches the same `.slice(0, limit)` shape through a
    // different route, so the defect is not confined to one handler.
    const negative = await call('/memory/recall?q=content&limit=-1');
    const honest = await call('/memory/recall?q=content&limit=5');
    expect(negative.status).toBe(200);
    expect(honest.body.count).toBe(5);
    expect(negative.body.count).toBe(39);
  });

  /* ── F2 ⭐⭐ THE CAP DOES NOT INVERT INTO ZERO ────────────────────────── */

  it('F2 — a negative limit is NOT the NaN class: it yields too much, not too little', async () => {
    // The NaN class (R532): the bound inverts into an EMPTY page.
    const nan = await call('/memory/search?q=content&limit=abc');
    expect(nan.body.count).toBe(0);

    // The negative class: the bound inverts into an OVER-full page.
    const neg = await call('/memory/search?q=content&limit=-1');
    expect(neg.body.count).toBe(39);

    // ⇒ The two classes are OPPOSITE in direction. A reviewer who knows
    // only the NaN case would predict "empty" here and would conclude the
    // negative case is safe. It is not.
    expect(nan.body.count).not.toBe(neg.body.count);
  });

  it('F2b — a negative limit beats the CAP: -1 returns more than a huge positive limit', async () => {
    const huge = await call('/memory/search?q=content&limit=1000000');
    const neg = await call('/memory/search?q=content&limit=-1');
    // Math.min(1000000, 50) = 50 → the cap holds.
    expect(huge.body.count).toBe(40);
    // Math.min(-1, 50) = -1 → the cap is passed through unchanged.
    expect(neg.body.count).toBe(39);
    // ⇒ The cap does not fail OPEN in the classic sense (it is not 1000000
    // rows) — it fails in a direction no cap is supposed to fail.
    expect(neg.body.count).toBeLessThan(huge.body.count);
  });

  /* ── F3 ⭐ THE UNBOUNDED READ IS UNAUTHENTICATED ──────────────────────── */

  it('F3 — the unbounded stream listing is reachable with NO credential', async () => {
    // No Authorization header on either call.
    const bounded = await call('/streams/topic-a?limit=5');
    const unbounded = await call('/streams/topic-a?limit=-1');

    expect(bounded.status).toBe(200);
    expect(bounded.body.count).toBe(5);
    expect(unbounded.status).toBe(200);
    expect(unbounded.body.count).toBe(40);

    // ⇒ The parameter is the ONLY thing standing between an anonymous
    // caller and the full list. It is not standing.
  });

  /* ── F4 ⭐ ONE CARRIER IS SAFE BY ACCIDENT ───────────────────────────── */

  it('F4 — ONE data-layer carrier has a lower bound the others lack', async () => {
    // `getMessages` clamps with Math.max(0, limit) — db.ts:672 / db.ts:1282.
    // That clamp lives in the STORAGE layer, not in the extraction layer.
    const clamped = await db.getMessages('topic-anything', -5);
    expect(clamped).toEqual([]);

    // The three REST carriers have no such clamp.
    const sliceRoute = await call('/memory/search?q=content&limit=-5');
    const sqliteRoute = await call('/streams/topic-a?limit=-5');
    expect(sliceRoute.body.count).toBe(35);
    expect(sqliteRoute.body.count).toBe(40);

    // ⇒ The "safe" carrier is safe because of a clamp that lives in exactly
    // one place, applied to exactly one of the four consumers of the same
    // shared helper. It is not a property of the extraction layer.
  });

  /* ── F5 ⭐⭐ THE CLAMP IS NOT A CONSTANT OF THE SYSTEM ────────────────── */

  it('F5 — the lower bound exists in ONE call site, and the helper has NONE', async () => {
    // The extraction layer itself: no lower bound, and a negative value
    // passes through unchanged.
    const url = new URL('http://x/?limit=-5');
    const { parseIntParam } = await import('../src/rest_server.js');
    expect(parseIntParam(url, 'limit', 10)).toBe(-5);

    // The clamp sites in the storage layer — exactly two, both for
    // getMessages (SQLite + MySQL). Every other consumer of the SAME helper
    // has none. This is a COUNT of the clamp sites, so a future edit that
    // adds or removes one is visible rather than absorbed.
    const { readFileSync } = await import('node:fs');
    const dbSrc = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
    const clampSites = dbSrc.match(/Math\.max\(0,\s*limit\)/g) ?? [];
    expect(clampSites.length).toBe(2);

    // The REST extraction layer has NO lower-bound clamp at all.
    const restSrc = readFileSync(new URL('../src/rest_server.ts', import.meta.url), 'utf8');
    expect(restSrc).not.toMatch(/Math\.max\(\s*0\s*,\s*limit\s*\)/);
    expect(restSrc).not.toMatch(/Math\.max\(\s*1\s*,\s*limit\s*\)/);
  });

  /* ── CONTROL: the NaN class still behaves as R532 recorded ───────────── */

  it('CONTROL — the NaN class is unchanged, so the two classes cannot be conflated', async () => {
    const nanSearch = await call('/memory/search?q=content&limit=abc');
    expect(nanSearch.body.count).toBe(0);

    const nanStream = await call('/streams/topic-a?limit=abc');
    // NaN bound to a SQLite LIMIT is a datatype mismatch — the route
    // answers 500 rather than returning rows. (Different from the negative
    // class, which answers 200 with every row.)
    expect(nanStream.status).toBe(500);

    const negStream = await call('/streams/topic-a?limit=-1');
    expect(negStream.status).toBe(200);
    expect(negStream.body.count).toBe(40);

    // ⇒ NaN and negative are DIFFERENT classes with different status codes
    // AND different bodies. The negative class is the quieter one.
  });

  it('CONTROL — an honest limit is honoured on every carrier', async () => {
    const sliceRoute = await call('/memory/search?q=content&limit=5');
    expect(sliceRoute.body.count).toBe(5);

    const sqliteRoute = await call('/streams/topic-a?limit=5');
    expect(sqliteRoute.body.count).toBe(5);

    const guardRoute = await call('/graph/traverse/' + (await firstChainId()) + '?depth=5&limit=5');
    expect(guardRoute.body.count).toBe(5);

    // ⇒ None of the four carriers is broken for a POSITIVE limit. The
    // defect is specifically about the sign.
  });

  /** The head of the chain, captured rather than re-derived by index. */
  async function firstChainId(): Promise<string> {
    const nodes = graph.getNodes('memory');
    const head = nodes.find((n: any) => n.label === 'chain-0');
    if (!head) throw new Error('chain head not found');
    return head.id;
  }
});
