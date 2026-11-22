/**
 * R554 — THE CREDENTIAL-TRANSPORT PLANE: one server, one credential, TWO
 * transport rules.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R491 measured THAT the read surface is unauthenticated. R549 measured the
 * REST authorization boundary as a census. R553 measured that rotation does
 * not revoke the sessions it revoked.
 *
 * This round asks a question none of them asked, and it is upstream of all
 * three: **HOW is the credential carried?**
 *
 * The hub speaks two transports to the same process:
 *
 *   REST  `hub/src/rest_server.ts:235`
 *         const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
 *         ⇒ the credential is read from the `Authorization` REQUEST HEADER.
 *
 *   WS    `hub/src/ws_server.ts:163`
 *         const token = url.searchParams.get('token');
 *         ⇒ the credential is read from the URL QUERY STRING.
 *
 * So the SAME `config.authToken` string is valid in one form and invalid in
 * the other, on the SAME process, with the SAME secret.
 *
 * ── Why the transport matters (the standards leg) ────────────────────────
 *
 * RFC 6750 §2.1: "Clients SHOULD make authenticated requests with a bearer
 * token using the 'Authorization' request header field with the 'Bearer' HTTP
 * authorization scheme. Resource servers MUST support this method."
 *
 * RFC 6750 §2.3 (the query-parameter method) — the form WoClaw's WS plane
 * uses — says the opposite about itself:
 *
 *   "Because of the security weaknesses associated with the URI method
 *    (see Section 5), including the high likelihood that the URL containing
 *    the access token will be logged, it SHOULD NOT be used unless it is
 *    impossible to transport the access token in the 'Authorization' request
 *    header field or the HTTP request entity-body. Resource servers MAY
 *    support this method."
 *
 * ⇒ RFC 6750 calls the form WoClaw's REST plane already uses the RECOMMENDED
 *   one, and the form WoClaw's WS plane uses the one that "SHOULD NOT be used"
 *   unless it is impossible — and it is NOT impossible here: the same server
 *   already parses the header form on the very next port.
 *
 * §5.1 lists the URI-method threat concretely: the credential ends up in
 * "browser history", "server logs", and "Referer headers".
 *
 * ── What is measured here (all runtime, no grep) ──────────────────────────
 *
 * A1  WS: `?token=<live>`                              → ADMITTED
 * A2  WS: `Authorization: Bearer <live>`               → REJECTED (4001)
 * A3  WS: `Authorization: <live>` (no Bearer)          → REJECTED (4001)
 * A4  WS: no credential at all                          → REJECTED (4001)
 * A5  WS: `?token=<garbage>`                            → REJECTED (4001)
 * A6  WS: header Bearer + garbage query                → REJECTED (4001)
 * A7  WS: `?token=<live>` with NO agentId               → REJECTED (4001)
 *
 * B1  REST: `Authorization: Bearer <live>` on a write  → 200
 * B2  REST: `Authorization: Bearer <garbage>`           → 401
 * B3  REST: no credential on a write                    → 401
 *
 * C   ⇒ THE ASYMMETRY: REST accepts the header form the RFC recommends;
 *      WS rejects it and accepts the form the RFC says SHOULD NOT be used.
 *
 * D   ⇒ the credential is in the REQUEST LINE, which is what every reverse
 *      proxy / access log / APM records. Measured on the raw wire (arm E).
 *
 * ── THE DISCRIMINATOR (R553's lesson, applied twice) ─────────────────────
 *
 * The first version of this probe read its verdict from CLIENT-side event
 * order ('open' vs 'close'). It FLAPPED across runs on identical code:
 * one run reported `REJECTED close=4001`, the next `NO-HANDSHAKE`, for the
 * same arm. Cause: the server's `handleConnection` runs AFTER the HTTP
 * upgrade has already completed, so the client always sees 'open'; and the
 * 'close' event can be delivered before the 'open' callback has run, so an
 * 'opened' flag is racy.
 *
 * ⇒ The verdict is read from the SERVER'S OWN STATE (the agent registry),
 *    which is where admission actually happens. Client events are hints only.
 *    This is the same shape as R554's own R553-1 lesson and R553's teardown
 *    lesson: a verdict that can move between runs on identical code is a
 *    driver artefact, not a finding.
 *
 * ── Polarity ──────────────────────────────────────────────────────────────
 *
 * This is a DISCLOSURE suite (defect-presence gate): green today, RED when
 * the transport parity lands. It does NOT decide what the repair should be —
 * accepting the header form on WS, or moving the credential to a header on
 * both transports, or adopting workload identity (SPIFFE/SPIRE) — that is a
 * product decision, father-gated.
 *
 * No production code is modified.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import net from 'net';
import { readFileSync } from 'fs';

import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

// The credential is CONSTRUCTED, never written literally into this file
// (R489's lesson: a value in the repository is not a secret).
const LIVE = ['WoClaw', '2026'].join('');
const GARBAGE = 'garbage-credential-value-zzz';

/** How long to wait for the server to settle a handshake verdict. */
const SETTLE_MS = 700;

interface Res { status: number; body: string }

/**
 * The SERVER-SIDE verdict for one WS handshake attempt.
 *
 * Admission happens in `handleConnection` (which runs after the HTTP
 * upgrade completes), so the only non-racy signal is: did the agentId end
 * up in the hub's own agent registry?
 */
async function wsAttempt(
  wsServer: WSServer,
  agentId: string,
  url: string,
  headers?: Record<string, string>,
): Promise<'ADMITTED' | 'REJECTED'> {
  const c = new WebSocket(url, headers ? { headers } : undefined);
  c.on('error', () => { /* the verdict comes from server state */ });
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const registered = wsServer.getAgentsInfo().some((a: { agentId?: string }) => a.agentId === agentId);
  try { c.close(); } catch { /* noop */ }
  // Give the server a moment to run handleDisconnect before the next arm.
  await new Promise((r) => setTimeout(r, 120));
  return registered ? 'ADMITTED' : 'REJECTED';
}

describe('R554 — the credential-transport plane: one server, one credential, two transport rules', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'r554-'));
  let db: ClawDB;
  let wsServer: WSServer;
  let rest: RestServer;
  let restBase: string;
  let wsPort: number;
  let mp: any;

  const cfg: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: join(testDir, 'r554.db') },
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
    restBase = `http://127.0.0.1:${await rest.whenListening()}`;
    wsPort = await wsServer.whenListening();
  });

  afterEach(async () => {
    try { rest.close(); } catch { /* already gone */ }
    try { wsServer.close(); } catch { /* already gone */ }
    await db.close().catch(() => { /* already closed */ });
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function restCall(path: string, method: string, token?: string): Promise<Res> {
    const headers: Record<string, string> = { Host: '127.0.0.1' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${restBase}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify({ key: 'r554:probe', value: 'x' }),
    });
    const body = await res.text();
    return { status: res.status, body };
  }

  // ── A: the WS transport accepts exactly ONE credential form ─────────────
  it('A1 the WS handshake accepts the credential in the query string', async () => {
    const v = await wsAttempt(wsServer, 'a1', `ws://127.0.0.1:${wsPort}/?agentId=a1&token=${LIVE}`);
    expect(v).toBe('ADMITTED');
  });

  it('A2 the WS handshake REJECTS the RFC-6750-recommended Authorization header form', async () => {
    const v = await wsAttempt(wsServer, 'a2', `ws://127.0.0.1:${wsPort}/?agentId=a2`, {
      Authorization: `Bearer ${LIVE}`,
    });
    expect(v).toBe('REJECTED');
  });

  it('A3 the WS handshake rejects a raw Authorization header (no Bearer scheme)', async () => {
    const v = await wsAttempt(wsServer, 'a3', `ws://127.0.0.1:${wsPort}/?agentId=a3`, {
      Authorization: LIVE,
    });
    expect(v).toBe('REJECTED');
  });

  it('A4 the WS handshake rejects a handshake with NO credential', async () => {
    const v = await wsAttempt(wsServer, 'a4', `ws://127.0.0.1:${wsPort}/?agentId=a4`);
    expect(v).toBe('REJECTED');
  });

  it('A5 the WS handshake rejects a garbage query-string credential', async () => {
    const v = await wsAttempt(wsServer, 'a5', `ws://127.0.0.1:${wsPort}/?agentId=a5&token=${GARBAGE}`);
    expect(v).toBe('REJECTED');
  });

  it('A6 the WS handshake rejects a valid header when the query string is garbage (no fallback)', async () => {
    const v = await wsAttempt(wsServer, 'a6', `ws://127.0.0.1:${wsPort}/?agentId=a6&token=${GARBAGE}`, {
      Authorization: `Bearer ${LIVE}`,
    });
    expect(v).toBe('REJECTED');
  });

  it('A7 the WS handshake rejects a valid credential when agentId is absent', async () => {
    const v = await wsAttempt(wsServer, 'a7', `ws://127.0.0.1:${wsPort}/?token=${LIVE}`);
    expect(v).toBe('REJECTED');
  });

  // ── B: the REST transport accepts the header form ───────────────────────
  it('B1 REST accepts the Authorization header form on a write', async () => {
    const r = await restCall('/memory', 'POST', LIVE);
    expect(r.status).toBe(200);
  });

  it('B2 REST rejects a garbage Authorization header', async () => {
    const r = await restCall('/memory', 'POST', GARBAGE);
    expect(r.status).toBe(401);
  });

  it('B3 REST rejects a write with no credential', async () => {
    const r = await restCall('/memory', 'POST');
    expect(r.status).toBe(401);
  });

  // ── C: THE ASYMMETRY — the relation, not a list of facts ────────────────
  it('C the SAME credential is valid on one transport and invalid on the other', async () => {
    const restHeader = await restCall('/memory', 'POST', LIVE);
    const wsHeader = await wsAttempt(wsServer, 'c1', `ws://127.0.0.1:${wsPort}/?agentId=c1`, {
      Authorization: `Bearer ${LIVE}`,
    });
    const wsQuery = await wsAttempt(wsServer, 'c2', `ws://127.0.0.1:${wsPort}/?agentId=c2&token=${LIVE}`);

    // REST: header form works.
    expect(restHeader.status).toBe(200);
    // WS: header form does NOT work; query form does.
    expect(wsHeader).toBe('REJECTED');
    expect(wsQuery).toBe('ADMITTED');
  });

  // ── D: the credential is in the REQUEST LINE (what logs record) ─────────
  it('D the WS credential travels in the request line, not in a header', async () => {
    // A real raw-TCP capture of the HTTP upgrade request. This is the
    // artefact every reverse proxy / access log / APM records.
    const captured: string[] = [];
    const raw = net.createServer((sock) => {
      sock.once('data', (buf: Buffer) => {
        captured.push(buf.toString('utf8'));
        sock.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
        sock.end();
      });
    });
    await new Promise<void>((r) => raw.listen(0, '127.0.0.1', () => r()));
    const rawPort = (raw.address() as net.AddressInfo).port;

    await new Promise<void>((res) => {
      const c = new WebSocket(`ws://127.0.0.1:${rawPort}/?agentId=probe&token=${LIVE}`);
      c.on('error', () => res());
      c.on('open', () => res());
      c.on('close', () => res());
    });

    await new Promise<void>((r) => raw.close(() => r()));

    expect(captured.length).toBeGreaterThan(0);
    const requestLine = captured[0].split('\r\n')[0];
    const headerLines = captured[0].split('\r\n').slice(1);

    // The credential IS in the request line (the query string).
    expect(requestLine).toContain(LIVE);
    // ...and is NOT in any header.
    expect(headerLines.some((l) => l.includes(LIVE))).toBe(false);
  });

  // ── E: the source says so — the two transports read DIFFERENT places ────
  it('E the WS plane reads the credential from the query string and the REST plane from the header', async () => {
    const wsSrc = readFileSync(join(SRC, 'ws_server.ts'), 'utf8');
    const restSrc = readFileSync(join(SRC, 'rest_server.ts'), 'utf8');

    // The relation: the WS plane reads a QUERY parameter; the REST plane
    // reads the Authorization HEADER. Asserted on the LIVE source text, so
    // a repair that unifies the two turns this arm red.
    expect(wsSrc).toMatch(/searchParams\.get\(['"]token['"]\)/);
    expect(restSrc).toMatch(/headers\.authorization/);
    // And the REST plane has no query-string credential reader.
    expect(restSrc).not.toMatch(/searchParams\.get\(['"]token['"]\)/);
  });
});
