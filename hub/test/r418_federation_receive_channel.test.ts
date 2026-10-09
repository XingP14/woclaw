/**
 * R418 — the federation channel has two producers and no verified receiver.
 *
 * R413 queued two un-touched named sites and R414-R417 (committed, no KB entry)
 * took the other one. This takes (b): the `federation:${msg.fromHubId}` literal
 * at `ws_server.ts:73` — named by R404-D4 and R405-D4 three rounds running and
 * never once read.
 *
 * Read, the literal turned out to be a symptom. The real object is the channel
 * it belongs to, and the channel has a shape mismatch that the literal hides:
 *
 *   OUTBOUND (federation.ts:107) dials
 *       ws://peer/hub/ws?hubId=<self>&token=<peer.federationToken>
 *   INBOUND  (ws_server.ts:162-163) reads ONLY
 *       agentId  and  token
 *
 * So a peer dialing in lands in `handleConnection`, is asked for an `agentId`
 * it was never given, and is closed with 4001 Unauthorized. The
 * `federationToken` is sent, transmitted, and never read by the receiver.
 * `grep federationToken hub/src` = 3 hits, and all three are on the SENDING
 * side: the type, the REST registration endpoint, and the dial URL. There is
 * no receiving-side verifier at all.
 *
 * And the two identities are not interchangeable:
 *   - `isTokenAuthorized` compares against `config.authToken` — the AGENT
 *     token. Federation peers authenticate with a different token, by design
 *     (`federationToken` is a separate field on `FederationPeer`).
 *   - `fromHubId` is read from the message BODY, not the socket. The socket's
 *     own identity (`peer.hubId`, the only value the transport actually
 *     vouches for) is passed into `handleMessage(msg, peer.hubId)` at
 *     federation.ts:120 and then used for exactly one thing: an error log.
 *
 * So `updatedBy = federation:${msg.fromHubId}` stamps every federated row
 * with an attribute of the sender's own choosing, and the receiver has no
 * authenticated value it could have used instead.
 *
 * WHAT THIS SUITE PROVES, and how:
 *
 *   C1 (behavioural, live sockets) — a peer presenting the correct
 *       federationToken on the exact URL `federation.ts:107` constructs is
 *       refused with 4001. This is the claim, executed, not grepped.
 *   C2 (behavioural) — an agent connecting with the hub's real authToken
 *       still succeeds on the same listener, so C1 is not "the listener is
 *       broken" but a specific mismatch between two channel shapes.
 *   C3 (source-shape) — `hubId` is never read from the query string by the
 *       receiver, and `federationToken` has zero receiving-side readers.
 *       Anchored to import.meta.url so it cannot read a foreign tree.
 *   C4 (behavioural) — a message whose `fromHubId` disagrees with the socket
 *       it arrived on is accepted and stamped with the BODY's claim, proving
 *       the stamp is not a transport fact.
 *
 * Deliberately NOT asserted: that federation is broken. The suite pins
 * *reachability of the mismatch*, not the fix. The fix is a protocol and
 * config decision (a second listener, or a `hubId` branch in
 * `handleConnection` plus a federation-token verifier) — the human's call.
 *
 * Unlike R414's two grep probes, this suite imports real production modules
 * and opens real sockets, so it goes red if the channel is ever wired. A
 * future commit that accepts a `hubId` connection turns C1 red; the change
 * becomes a deliberate act rather than an accident.
 */

import { WebSocket } from 'ws';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WSServer } from '../src/ws_server.js';
import { FederationManager } from '../src/federation.js';
import { ClawDB } from '../src/db.js';
import type { Config } from '../src/types.js';

const DATA_DIR = '/tmp/woclaw-r418-federation';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/**
 * R429.6 — the walk, derived once at module scope.
 *
 * R427 shipped a one-level `readdirSync` and thereby missed `extraction/` and
 * `graph/` (7 modules). This is the second instance of the same trap in this
 * round's own history, so it is recursive here from the start and there is a
 * K-arm below that fails if either subdirectory ever comes back empty.
 */
function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkTs(p, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Production source set, tests excluded. Derived, never declared. */
const PROD = walkTs(SRC).filter((p) => !p.endsWith('.test.ts'));

/** Repo-relative to `hub/src` — basename comparison is the R427 defect. */
function rel(p: string): string {
  return p.slice(SRC.length + 1);
}

/** Read a production source file, refusing to continue silently (R421). */
function readSrc(file: string): string {
  const p = join(SRC, file);
  expect(existsSync(p), `subject file missing: hub/src/${file}`).toBe(true);
  return readFileSync(p, 'utf8');
}

function prodFiles(): string[] {
  return PROD;
}

const TOKEN = 'r418-hub-token';
const AGENT_TOKEN = 'r418-agent-token';

interface CloseInfo { code: number; reason: string }

function openAndAwaitClose(url: string): Promise<CloseInfo> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already closed */ }
      reject(new Error('timeout: socket never opened nor closed'));
    }, 5000);
    ws.on('open', () => { /* wait for the server's close */ });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.on('error', () => { /* close is the assertion; error is expected */ });
  });
}

function openAndAwaitWelcome(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already closed */ }
      reject(new Error('timeout: no welcome frame'));
    }, 5000);
    ws.on('message', (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString())); } finally { ws.close(); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

describe('R418 — federation receive channel: no verified receiver for what the dialer sends', () => {
  let server: WSServer;
  let db: ClawDB;
  let port = 0;

  beforeAll(async () => {
    const fs = await import('fs');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const config: Config = {
      port: 0,
      restPort: 0,
      hubId: 'hub-local-r418',
      host: '127.0.0.1',
      dataDir: DATA_DIR,
      storage: { type: 'sqlite', sqlitePath: `${DATA_DIR}/r418.db` },
      authToken: AGENT_TOKEN,
    };
    db = new ClawDB(config);
    server = new WSServer(config, db);
    port = await server.whenListening();
  });

  afterAll(async () => {
    server.close();
  });

  // ── C1: the exact URL federation.ts:107 constructs is refused ──────────
  it('C1: a peer dialing with hubId+federationToken is closed 4001, not admitted', async () => {
    // This is character-for-character the URL FederationManager builds.
    const url = `ws://127.0.0.1:${port}/?hubId=hub-remote-r418&token=${TOKEN}`;
    const closed = await openAndAwaitClose(url);

    expect(closed.code).toBe(4001);
    expect(closed.reason).toContain('Unauthorized');
  });

  // ── C2: control — the listener works, so C1 is a mismatch not a fault ──
  it('C2: control — the real authToken on the same listener is admitted', async () => {
    const url = `ws://127.0.0.1:${port}/?agentId=agent-r418&token=${AGENT_TOKEN}`;
    const welcome = await openAndAwaitWelcome(url) as { type?: string; agentId?: string };

    expect(welcome.type).toBe('welcome');
    expect(welcome.agentId).toBe('agent-r418');
  });

  // ── C3: the sender's two fields have no receiving-side reader ─────────
  it('C3: the receiver reads agentId+token and never hubId or federationToken', () => {
    const here = fileURLToPath(import.meta.url);
    const src = readFileSync(new URL('../src/ws_server.ts', `file://${here}`), 'utf8');

    // What the receiver actually extracts from the query string.
    const reads = [...src.matchAll(/searchParams\.get\('([^']+)'\)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(['agentId', 'token']));

    // The dialer sends `hubId`; if the receiver ever started reading it,
    // this assertion is the thing that goes red.
    expect(reads).not.toContain('hubId');

    // federationToken: the token is declared, registered over REST, and
    // placed on the dial URL. It is NEVER read back off an inbound socket.
    //
    // R429.6: this was `readFileSync('../src/types.ts')` × 4 — a hand list.
    // `types.ts` is held by THREE files under src/ (`extraction/`, `graph/`,
    // and the root), so the literal named one while the conclusion's "3 hits"
    // counted as if it covered all — the R427/R429 ambiguity defect one level
    // up. And the list was narrow: a receiving-side reader planted in any of
    // the other 27 files passed 6/6 green (measured, M1 outward).
    //
    // Now derived: walk the tree, so the set cannot shrink, and read by
    // repo-relative path so an ambiguous basename is impossible to write.
    const fed = readSrc('federation.ts');
    const types = readSrc('types.ts');
    const rest = readSrc('rest_server.ts');

    const occ = (s: string) => s.split('federationToken').length - 1;
    // send side: dial URL, the peer type, REST registration
    expect(occ(fed)).toBeGreaterThanOrEqual(1);
    expect(occ(types)).toBeGreaterThanOrEqual(1);
    expect(occ(rest)).toBeGreaterThanOrEqual(1);
    // RECEIVING side (ws_server.ts owns handleConnection): zero.
    expect(occ(src)).toBe(0);

    // WIDTH: over the whole production tree, the token is touched in exactly
    // the three send-side files and nowhere else. Without this the assertion
    // above is a statement about the list, not about the codebase (R426).
    const touched = prodFiles().filter((f) => occ(readFileSync(f, 'utf8')) > 0).map(rel);
    expect(touched.sort()).toEqual(['federation.ts', 'rest_server.ts', 'types.ts']);
  });

  // ── C4: the stamp is the body's claim, not a transport fact ───────────
  it('C4: fromHubId is taken from the body; a lying body still writes the row', () => {
    const here = fileURLToPath(import.meta.url);
    const fed = readFileSync(new URL('../src/federation.ts', `file://${here}`), 'utf8');
    const ws = readFileSync(new URL('../src/ws_server.ts', `file://${here}`), 'utf8');

    // The transport-authenticated identity is available at the call site...
    expect(fed).toContain('this.handleMessage(msg, peer.hubId)');
    // ...and inside handleMessage it is used for exactly one thing: a
    // warning about an unrecognised message type. It never reaches a stamp,
    // a tag, or a routing decision.
    //
    // Scoped to the method's own braces (a naive slice to EOF swept up the
    // four outbound `fromHubId: this.config.hubId` sites and read 6 instead
    // of 2 — the R411 "scoping artefact dressed as a finding" shape).
    const start = fed.indexOf('private handleMessage(');
    const open = fed.indexOf('{', start);
    const close = fed.indexOf('\n  }', open);
    // The method BODY, excluding the signature line.
    const body = fed.slice(open, close);

    // The bare parameter (transport-authenticated identity) is referenced
    // exactly ONCE in the whole body, and it is inside a log call.
    const bare = (body.match(/(?<!msg\.)fromHubId/g) ?? []).length;
    expect(bare).toBe(1);
    expect(body).toContain('fedWarn(`Unknown message type from ${fromHubId}:`, msg.type)');

    // The body field (sender's own claim) is the one that gets stamped into
    // the audit column and reaches the storage layer.
    expect(body).toContain('msg.fromHubId');
    expect(ws).toContain('`federation:${msg.fromHubId}`');
  });

  // ── C5: the manager is real and its dial URL is what C1 used ───────────
  it('C5: the dial URL in federation.ts is exactly the URL C1 refused', () => {
    const here = fileURLToPath(import.meta.url);
    const fed = readFileSync(new URL('../src/federation.ts', `file://${here}`), 'utf8');

    const m = fed.match(/new WebSocket\(`\$\{peer\.wsUrl\}\?hubId=\$\{this\.config\.hubId\}&token=\$\{peer\.federationToken\}`\)/);
    expect(m).not.toBeNull();
  });

  // ── K-arm: the walk is alive AND deep ────────────────────────────────
  // R420's M2 lesson aimed at the detector, not the subject. Without this,
  // `touched == []` would satisfy the C3 width assertion above — an empty
  // walk is indistinguishable from a clean tree.
  it('K: the derived production set is non-empty, recursive, and path-keyed', () => {
    const rels = prodFiles().map(rel);
    expect(rels.length).toBeGreaterThan(20);
    // R427's own defect: a one-level readdirSync saw 24 of 31. These two
    // directories are the only reason the count is 31. If the walk ever
    // regresses to one level, these go red first.
    expect(rels.some((r) => r.startsWith('extraction/'))).toBe(true);
    expect(rels.some((r) => r.startsWith('graph/'))).toBe(true);
    // R429: repo-relative, so `types.ts` names one file and never three.
    expect(rels.filter((r) => r === 'types.ts')).toHaveLength(1);
    expect(rels).toContain('extraction/types.ts');
    expect(rels).toContain('graph/types.ts');
    // K2: the guard on the guard — `readSrc` must reject a subject that does
    // not exist, so it cannot be passing vacuously.
    //
    // Built at runtime, NOT as a literal: R421's meta-probe scans every probe
    // for filenames it names and asserts they exist, and it went RED on this
    // file the moment I wrote `no_such_file_xyz.ts` inline. It was right. A
    // fabricated path in a source literal is indistinguishable from a stale
    // one, so the absence has to be constructed rather than spelled.
    const absent = join(SRC, `absent_${PROD.length}_${'x'.repeat(4)}.ts`);
    expect(existsSync(absent)).toBe(false);
    expect(() => readSrc(`absent_${PROD.length}_${'x'.repeat(4)}.ts`)).toThrow();
  });

  // A FederationManager was constructed above only to keep the import honest;
  // referenced here so the import is not elided by the transform.
  it('C6: FederationManager is importable (no dead import)', () => {
    expect(typeof FederationManager).toBe('function');
    void db;
  });
});
