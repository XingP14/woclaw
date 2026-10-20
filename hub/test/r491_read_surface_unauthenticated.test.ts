/**
 * R491 — the read surface is UNAUTHENTICATED, and the credential that protects
 * the write surface is served by that same unauthenticated read surface.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74). R441–R490 were 40+ consecutive in-cluster rounds. This
 * round opens a NEW plane — **the credential-scope plane: which operations
 * does a credential gate, and which does it merely decorate?** — and runs
 * the EXTERNAL leg first (HN Algolia + GitHub search, controls first).
 *
 *   HN Algolia: CTRL `agent` = 531,851 / `API` = 555,303 / `npm` = 42,366 /
 *   `secret` = 26,935 (so the zeros below are evidence, not a dead probe).
 *   Precision angles: `npm unpublish secret` = 1 · `npm registry credential
 *   leak` = 1 · `immutable artifact rotation credential` = **0** ·
 *   `publish rotate credential registry` = **0** ·
 *   `API read unauthenticated read` = 1 · `token rotation does not protect
 *   read endpoint` = **0** · `API exposes data read without auth` = 3.
 *   GitHub: `npm registry secret scanner` = **0 repos** ·
 *   `npm unpublish automation` = **0** · `read endpoint authorization agent`
 *   = 2 (1★ + 0★, both noise).
 *
 *   NOT reported as greenfield: read/write authorization splits, credential
 *   rotation, registry purge, and CDNs are all solved in adjacent fields
 *   (API gateways, OIDC scopes, npm unpublish policy, CloudFront). This is a
 *   MIGRATION GAP (R449-5 / R454-4 / R475-3 discipline), and reporting
 *   virgin territory here would be wrong.
 *
 * -----------------------------------------------------------------------
 * WHAT THE PREVIOUS ROUND (R489) FOUND, AND WHAT IT MISSED
 *
 * R489 established, correctly and with live probes, that the production token
 * `WoClaw2026` is (a) live, (b) in a public GitHub repo, (c) in 7 files of
 * the published `woclaw-hooks@0.5.0` npm tarball, and (d) the default in
 * `hub/public/index.html`. It then offered three remediation options and
 * marked them father-gated.
 *
 * This round tests the PREMISE of option A ("delete the npm version — the
 * only thing that can make the secret in history disappear"). The premise is
 * FALSE, and it is false in a way that changes the remediation:
 *
 *   F1. **The published surface is 7 packages and 26 versions, not 1 package
 *       and 1 version.** R489 audited `woclaw-hooks@0.5.0`. Measured here:
 *       `woclaw-hooks` (5 versions), `woclaw-hub` (5), `xingp14-woclaw` (9),
 *       `woclaw-codex` (3), `woclaw-mcp` (3), `opencode-woclaw` (1). Seven of
 *       them are PUBLISHED and five of the six published packages carry the
 *       token in at least one version — 17 of 25 published versions contain
 *       it. "Delete the npm version" names one of 17.
 *
 *   F2. **An unpublish cannot reach the copies.** Four independent retrieval
 *       surfaces serve the same bytes today: registry.npmjs.org, unpkg,
 *       jsdelivr, registry.npmmirror.com — and registry.yarnpkg.com. npm's
 *       unpublish removes the version from the registry's metadata and
 *       returns 404 on the tarball path (verified against the KNOWN removed
 *       versions `event-stream@3.3.6` and `flatmap-stream@0.1.1`: the
 *       registry metadata loses them, the time entry survives for one of
 *       them, and all three CDNs then 404). So a purge DOES reach the
 *       origin — but ONLY the origin. A third party who downloaded the
 *       tarball before the purge keeps a copy forever, and the npm CDN
 *       copies are independently cached with `max-age=31536000, immutable`.
 *       Deleting the version makes the secret *less* discoverable; it does
 *       not make it *disappear*, and it is not the only thing that changes
 *       the risk — **rotation does**, because rotation is the only action
 *       that makes every already-captured copy useless.
 *
 *   F3. 🔴 **THE HEADLINE: the read surface is UNAUTHENTICATED, and the
 *       credential for the write surface is served BY that read surface.**
 *       `rest_server.ts:236` is
 *           const requiresAuth = method !== 'GET' || path === '/admin/token/status';
 *       — every GET route except one is reachable with NO credential. And
 *       the Web UI (`hub/public/index.html`, served by the static server on
 *       :8084 with no credential of its own) contains
 *           return params.get('token') || 'WoClaw2026';
 *       So the escalation is: GET the UI HTML unauthenticated → read the
 *       token out of the source → use it for an admin call. Measured: the
 *       served HTML yields `WoClaw2026`, and that value gets HTTP 200 on
 *       `GET /admin/token/status` (the same route returns 401 with no token).
 *       **R489's remediation (rotate the token) does NOT close this path**:
 *       rotating changes the constant in `index.html`, and the next reader
 *       harvests the NEW constant from the same unauthenticated HTML. The
 *       read surface is the durable leak; the constant is the disposable part.
 *
 *   F4. 🔴 **Rotation provably cannot protect the read surface, structurally
 *       and empirically.** `requiresAuth` does not reference the token for
 *       GET: `GET /memory` returns byte-identical bodies with the live
 *       token, with a garbage token, and with no `Authorization` header at
 *       all. Every GET route the server implements answers 200 or 4xx
 *       unauthenticated — and they yield the production agent's own working
 *       notes (`codex:context`, 633 historical versions) plus the graph, the
 *       topics, the agent list and the federation peer list.
 *
 *   F5. **The published copy is a COMPRESSED stream, and a byte-grep on the
 *       downloaded `.tgz` is a FALSE NEGATIVE.** The literal token does not
 *       appear in the raw gzip bytes of any tarball; it appears only after
 *       decompression. Measured: **17 of 25** published versions are
 *       `RAW_SCAN=MISS, DECOMPRESSED=HIT`. A secret scanner that greps the
 *       tarball bytes reports CLEAN on 17 of 17 token-bearing versions.
 *
 *   F6. **`npm unpublish` IS available** (all five `woclaw-hooks` versions
 *       are 200+ days old ⇒ past the 72h window; downloads are 1/week and
 *       12/month, far under the 3000/week popularity gate). So F2 is not
 *       "you cannot unpublish" — it is "unpublishing is necessary and NOT
 *       sufficient, and it is one of 17 versions".
 *
 * -----------------------------------------------------------------------
 * WHAT THIS SUITE PINS (CURRENT behaviour, RED against the defect)
 *
 *   P1  The gate is a METHOD predicate, so the set of GET routes the server
 *       implements is the subject set — and the ONLY GET route it gates is
 *       `/admin/token/status`. **P1 DERIVES that subject set FROM THE TREE**
 *       (every `path === '…'` and `path.startsWith('…')` literal in
 *       `src/rest_server.ts`) instead of listing it by hand, so a newly
 *       added route joins the subject set automatically. See the note below.
 *   P2  A GET on a memory route returns the memory with NO credential.
 *   P3  A GET on a memory route returns the SAME bytes with a garbage
 *       credential and with the live credential (the gate is absent, not
 *       merely permissive).
 *   P4  The Web UI's served HTML contains a credential literal that
 *       authorises an admin route — the escalation, closed.
 *   P5  NEGATIVE CONTROL: a WRITE route (POST /memory) with no credential is
 *       rejected 401 — so the suite proves the read gate is *missing*, not
 *       that auth is broken.
 *   P6  A WRITE route with the live credential is accepted (200) — the
 *       credential is a working write credential, so P4's escalation is
 *       real and not a dead string.
 *   P7  The hub's own API doc marks `/memory` (and 6 other GET routes) as
 *       "无需认证" (no authentication required) — so the read posture is
 *       DOCUMENTED, and the defect is that the same doc's "写操作需要认证"
 *       (writes need auth) line invites the reader to treat the token as
 *       the whole access-control story. P7 is a doc-vs-code consistency
 *       assertion, deliberately weak on its own (R469-4 / R486-M3), and it is
 *       corroborated by P2–P6 rather than standing alone.
 *   P8  A repair to P1 (gate the GET routes) turns P2/P3 red. This arm is
 *       written with `it.fails(...)` so the suite stays GREEN while the
 *       defect stands and turns RED the moment the defect is repaired
 *       (the r481 / 31bb376 convention).
 *
 * -----------------------------------------------------------------------
 * WHY P1 IS TREE-DERIVED (measured defect in the adopted artifact)
 *
 * This file was staged by a tick that died before committing. As adopted, its
 * P1 enumerated 17 GET routes BY HAND and asserted that exactly those 17
 * answer 200 unauthenticated. Measured against the real server: the
 * unauthenticated-200 surface is **19** routes — `/graph/traverse/:node` and
 * `/streams/:topic` were missing from the hand list — and the server
 * implements 33 route literals in total. A hand list is a FIXED subject set:
 * a route added to `rest_server.ts` tomorrow would NOT be probed and the
 * suite would stay green, which is the exact defect class this repo has
 * already paid for (R437 "derive the subject set from the tree, not a hand
 * list"; R449 "an inventory is not a relation"; R483 "a suite whose arms
 * read committed history is blind to the live tree").
 *
 * So P1 now derives the subject set from `src/rest_server.ts` at run time and
 * asserts the RELATION over it: **the set of derived GET routes that
 * answer 401 without a credential is exactly `{/admin/token/status}`**. That
 * relation is what the gate predicate guarantees, so it is true today, and
 * adding any route to the tree cannot silently escape the probe.
 *
 * A small hand-written list survives as a SANITY floor (P1a): it asserts the
 * derived set CONTAINS the well-known members. A hand list used as a subset
 * check cannot hide a new route, which is why it is safe here; used as an
 * equality check (as adopted) it hides one.
 *
 * -----------------------------------------------------------------------
 * SCOPE AND HONEST LIMITS
 *
 *   - This suite measures the LOCAL hub (a real RestServer on an ephemeral
 *     port, a real SQLite file, a real MemoryPool). It does NOT assert
 *     anything about the production deployment's network exposure, which is
 *     environment-specific and was measured separately.
 *   - The suite does NOT contain the live token as a literal. It builds the
 *     credential from parts at runtime so that the test file itself is not
 *     a copy of the secret (R489's own lesson: a value that is in the repo
 *     is not a secret).
 *   - No production code is modified. `git diff --stat -- hub/src` is empty.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const REST_SERVER_SRC = join(SRC, 'rest_server.ts');

// The credential is CONSTRUCTED, never written literally into this file.
// R489: a value that appears in the repository is not a secret, and a test
// file is part of the repository.
const LIVE = ['WoClaw', '2026'].join('');
const GARBAGE = 'garbage-credential-value-zzz';

interface Res { status: number; body: string; headers: Record<string, string> }

/** Drive the real RestServer over a real socket. */
async function call(
  base: string,
  path: string,
  opts: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<Res> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Host: '127.0.0.1' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text, headers: Object.fromEntries(res.headers) };
}

// ─────────────────────────────────────────────────────────────────────────
// DERIVING THE ROUTE SUBJECT SET FROM THE TREE
//
// The gate is `method !== 'GET' || path === '/admin/token/status'`, so the
// subject set of P1 is "every GET route the server implements". We derive it
// from the source text of the dispatcher, because a hand-written list is a
// fixed set that silently excludes any route added later.
//
// The extraction is deliberately narrow and self-checking: it strips
// comments first (a route literal inside a comment is not a route), then
// collects `path === '<literal>'` and `path.startsWith('<literal>')`. The
// regex routes (`/streams/…`, `/delegations/…`, `/graph/nodes/…`,
// `/graph/edges/…`) are all covered by a `startsWith` prefix, so they are
// already in the derived set.
// ─────────────────────────────────────────────────────────────────────────

/** Remove `//` and block comments, leaving string/regex literals intact. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i + 1 < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i];
          i++;
        }
        if (i < n) {
          out += src[i];
          i++;
        }
      }
      if (i < n) {
        out += src[i];
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface DerivedRoutes {
  exact: string[];
  prefixes: string[];
  /** Concrete URLs to probe: exact literals as-is, prefixes with a segment. */
  probes: string[];
}

function deriveRoutes(srcPath: string): DerivedRoutes {
  const code = stripComments(readFileSync(srcPath, 'utf8'));
  const exact = [...new Set([...code.matchAll(/path\s*===\s*'([^']+)'/g)].map((m) => m[1]))].sort();
  const prefixes = [...new Set([...code.matchAll(/path\.startsWith\('([^']+)'\)/g)].map((m) => m[1]))].sort();
  const probes = [
    ...exact,
    ...prefixes.map((p) => `${p}r491probe`),
  ].sort();
  return { exact, prefixes, probes };
}

const DERIVED = deriveRoutes(REST_SERVER_SRC);

/** Well-known members — used as a SANITY FLOOR (subset check), not equality. */
const KNOWN_GET_ROUTES = [
  '/health', '/ready', '/topics', '/agents', '/rate-limits',
  '/memory', '/memory/stats', '/memory/tags/probe', '/memory/search?q=probe',
  '/memory/recall?q=probe', '/graph', '/graph/nodes', '/graph/edges',
  '/graph/stats', '/sessions', '/delegations', '/federation/peers',
];

/** The ONE GET route the gate protects. */
const GATED_GET_ROUTE = '/admin/token/status';

describe('R491 — the read surface is unauthenticated, and it serves the write credential', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'r491-'));
  let db: ClawDB;
  let wsServer: WSServer;
  let rest: RestServer;
  let base: string;
  let mp: any;

  const cfg: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: join(testDir, 'r491.db') },
    authToken: LIVE,
  } as unknown as Config;

  beforeEach(async () => {
    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    mp = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    mp.graphStore = graph;
    rest = new RestServer(cfg, db, topics, mp, graph, wsServer);
    await rest.start();
    const boundPort = await rest.whenListening();
    base = `http://127.0.0.1:${boundPort}`;

    // A real record, written THROUGH the write path (so it is a real row).
    await mp.write('probe:secret-note', 'PROBE_VALUE_MARKER', 'r491-probe', ['probe'], 0);
  });

  afterEach(async () => {
    try { rest.close(); } catch { /* already gone */ }
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  // ── P1: the gate is a METHOD predicate, over a TREE-DERIVED subject set ─
  it('P1 exactly ONE derived GET route is gated; every other derived GET route is reachable with NO credential', async () => {
    // Sanity floor: the derivation must not be degenerate. If it returned an
    // empty or tiny set, the relation below would pass vacuously.
    expect(DERIVED.probes.length).toBeGreaterThanOrEqual(30);
    expect(DERIVED.exact.length).toBeGreaterThanOrEqual(20);
    expect(DERIVED.prefixes.length).toBeGreaterThanOrEqual(10);
    for (const known of KNOWN_GET_ROUTES) {
      const bare = known.split('?')[0];
      // A known route is COVERED by the derivation if it is an exact literal
      // OR if one of the derived prefixes contains it (e.g. '/memory/tags/probe'
      // is covered by the derived prefix '/memory/tags/'). The prefix form is
      // what the server actually dispatches on.
      const covered =
        DERIVED.exact.includes(bare) ||
        DERIVED.prefixes.some((p) => bare.startsWith(p));
      expect(covered, `known route ${known} not covered by the derived route set`).toBe(true);
    }
    expect(DERIVED.exact).toContain(GATED_GET_ROUTE);

    // The relation: which derived GET routes answer 401 without a credential?
    const gated: string[] = [];
    const reachable: string[] = [];
    for (const route of DERIVED.probes) {
      const r = await call(base, route);
      if (r.status === 401) gated.push(route);
      else reachable.push(route);
    }
    expect(gated).toEqual([GATED_GET_ROUTE]);
    expect(reachable.length).toBe(DERIVED.probes.length - 1);
  });

  // ── P1a: the hand list is a SUBSET check, never an equality check ───────
  it('P1a the well-known GET routes are all reachable with NO credential', async () => {
    const notOpen: string[] = [];
    for (const route of KNOWN_GET_ROUTES) {
      const r = await call(base, route);
      if (r.status !== 200) notOpen.push(`${route}=${r.status}`);
    }
    expect(notOpen).toEqual([]);
  });

  // ── P2: the memory read yields data with no credential ─────────────────
  it('P2 GET /memory returns the stored record with NO Authorization header', async () => {
    const r = await call(base, '/memory');
    expect(r.status).toBe(200);
    expect(r.body).toContain('probe:secret-note');
    expect(r.body).toContain('PROBE_VALUE_MARKER');
  });

  it('P2b GET /memory/<key> returns the stored record with NO Authorization header', async () => {
    const r = await call(base, '/memory/probe:secret-note');
    expect(r.status).toBe(200);
    expect(r.body).toContain('PROBE_VALUE_MARKER');
  });

  // ── P3: the gate is ABSENT, not permissive ─────────────────────────────
  it('P3 the read body is identical with no credential, a garbage credential and the live credential', async () => {
    const none = await call(base, '/memory');
    const bad = await call(base, '/memory', { token: GARBAGE });
    const good = await call(base, '/memory', { token: LIVE });
    expect(bad.status).toBe(200);
    expect(good.status).toBe(200);
    expect(bad.body).toBe(none.body);
    expect(good.body).toBe(none.body);
  });

  // ── P4: the escalation — the UI serves the write credential ────────────
  it('P4 the served Web UI source contains a credential literal, and that literal authorises an admin route', async () => {
    // The UI is a static file served by a separate server; here we read the
    // SAME file the UI server reads (hub/public/index.html) and drive the
    // admin route with whatever literal it contains. The point of the arm is
    // the RELATION: "a literal in the served UI source is a working
    // credential", not the specific string.
    const uiPath = join(HERE, '..', 'public', 'index.html');
    expect(existsSync(uiPath)).toBe(true);
    const html = readFileSync(uiPath, 'utf8');

    const m = html.match(/params\.get\('token'\)\s*\|\|\s*'([^']+)'/);
    expect(m, 'the UI source must contain a token default expression').not.toBeNull();
    const harvested = m![1];
    expect(harvested.length).toBeGreaterThan(6);

    // The harvested literal is a WORKING admin credential on this server,
    // because this server's authToken is that same literal.
    const admin = await call(base, '/admin/token/status', { token: harvested });
    expect(admin.status).toBe(200);
    // ...and the same route without it is refused, so P4 is not vacuous.
    const refused = await call(base, '/admin/token/status');
    expect(refused.status).toBe(401);
  });

  // ── P5/P6: the write side is gated, and the credential works there ─────
  it('P5 a WRITE route with no credential is refused 401 (the read gate is missing, not auth in general)', async () => {
    const r = await call(base, '/memory', { method: 'POST', body: { key: 'p5:probe', value: 'x' } });
    expect(r.status).toBe(401);
  });

  it('P6 a WRITE route with the live credential is accepted, so the credential is a working write credential', async () => {
    const r = await call(base, '/memory', {
      method: 'POST', token: LIVE, body: { key: 'p6:probe', value: 'P6_MARKER' },
    });
    expect(r.status).toBe(200);
    const back = await call(base, '/memory/p6:probe');
    expect(back.status).toBe(200);
    expect(back.body).toContain('P6_MARKER');
  });

  // ── P7: the doc states the read posture (weak on its own) ──────────────
  it('P7 the API doc marks the read routes as not requiring authentication', () => {
    const apiDoc = readFileSync(join(HERE, '..', '..', 'docs', 'API.md'), 'utf8');
    // The doc's own claim that reads need no auth, for the memory list route.
    const memorySection = apiDoc.split('GET /memory`')[1] ?? '';
    expect(memorySection.slice(0, 200)).toContain('无需认证');
    // And the doc's claim that writes DO need auth — which is what makes the
    // token look like the whole access-control story.
    expect(apiDoc).toContain('写操作需要认证');
  });

  // ── P8: the repair arm (RED against the defect) ────────────────────────
  it.fails('P8 REPAIR ARM: a GET on a memory route must require a credential', async () => {
    const r = await call(base, '/memory');
    expect(r.status).toBe(401);
  });
});
