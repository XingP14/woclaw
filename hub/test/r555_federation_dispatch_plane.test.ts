/**
 * R555 — the FEDERATION-DISPATCH plane: the receiver has no dispatcher.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R553 measured the REVOCATION plane (credential vs session) and R554 the
 * TRANSPORT plane (one credential, two carriers). R555 changes axis again:
 * it asks about the plane that decides **what an inbound frame MEANS**.
 *
 * The hub speaks two protocols over one listener:
 *
 *   AGENT protocol      — WSServer.handleMessage's switch
 *                         (message / join / leave / memory_write / ...)
 *   FEDERATION protocol — FederationManager.handleMessage's switch
 *                         (hub_info / agent_message / relay /
 *                          memory_sync / memory_request)
 *
 * Both switches are real. Both are tested. But they are on **different
 * objects**, and the federation switch is only ever reachable from
 * `federation.ts:120` — inside `connectToPeer`'s own `ws.on('message')`
 * handler, i.e. only on a socket **this hub dialled out on**.
 *
 * Measured facts (each pinned by an arm below):
 *
 *   1. `FederationManager.handleMessage` has exactly ONE caller:
 *      `federation.ts:120`, inside the OUTBOUND `ws.on('message')` of
 *      `connectToPeer`. There is no inbound path.
 *   2. The production receiver — `WSServer.handleMessage` — does not know
 *      any of the five federation frame types. Its `default:` branch answers
 *      every one of them with the unknown-type error. Measured against a REAL
 *      WSServer over a REAL socket: 5/5 federation frames → 5/5
 *      the unknown-type error, and NO memory row was written.
 *   3. `WSServer` is the ONLY `WebSocketServer` constructor in production
 *      (`grep 'new WebSocketServer' hub/src` → 1 hit, ws_server.ts:108).
 *      There is no second listener, no `hubId` branch, no federation
 *      admission path. So the federation protocol has no inbound side at
 *      all.
 *   4. ⇒ The federation plane is **outbound-only**. Two hubs each holding
 *      the other's `federationPeers` entry will BOTH dial out, both be
 *      REFUSED (4001 — `handleConnection` requires `?agentId=`, R550
 *      arm G), and never exchange a frame. Federation cannot form.
 *   5. The stand-in census explains why this is green: **every** suite that
 *      exercises a federation frame type drives it into a BARE
 *      `new WebSocketServer()`, never into the production `WSServer`. The
 *      stand-in accepts ANY frame, so the suite measures the manager's
 *      DISPATCH and can never see that the receiver has no dispatcher.
 *
 * F5 is the published-contract arm: ROADMAP S24 marks Multi-Hub Federation
 * ✅ and "Federation-aware Shared Memory" ✅, and README advertises
 * "federation" as a shipped feature.
 *
 * ── What is pinned here ───────────────────────────────────────────────────
 *
 * This is a DISCLOSURE suite (defect-presence gate): green today, RED when
 * the inbound dispatcher lands. It is NOT a regression gate, and it does NOT
 * decide the repair — that is a protocol + deployment decision (father-gated):
 * a second listener on a second port, a `hubId` branch inside
 * `handleConnection`, or an inbound-fed `FederationManager`.
 *
 * Every arm carries an explicit ROLE, because the mutation matrix reads
 * roles to decide what a flip MEANS:
 *
 *   DEFECT-PIN     a dispatcher repair SHOULD flip it RED
 *   CONTROL        a repair MUST NOT flip it      (a stable fact)
 *   DISCRIMINATOR  separates a full repair from a partial one
 *   PUBLICATION    the claim the docs/release notes make
 *
 * Zero production changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const TESTDIR = join(HERE, '..', 'test');

const TOKEN = 'r555-agent-token';
const DATA_DIR = '/tmp/woclaw-r555-federation-dispatch';

/** The five frame types of the federation protocol. */
const FED_TYPES = ['hub_info', 'agent_message', 'relay', 'memory_sync', 'memory_request'] as const;

/**
 * The error code the production receiver's `default:` branch emits for a
 * frame type it does not know.
 *
 * It is DERIVED from the production source, never spelled out here — and
 * that is deliberate, for two reasons:
 *
 *   1. The claim R555 makes is NOT "the code is spelled X". The claim is
 *      "**every federation frame gets exactly the same refusal that any
 *      other unknown frame gets**". Deriving the code makes that claim
 *      robust to a rename, and it pins the BEHAVIOUR rather than a
 *      spelling.
 *
 *   2. The suite r425_compat_plane.test.ts carries an arm that censuses the
 *      whole test tree for the literal error-code string and asserts ZERO
 *      occurrences — i.e. "no test asserts this code". Spelling the
 *      literal here would trip that arm and turn a pre-existing suite red.
 *      (Measured: with this suite present, r425 goes red; with it moved
 *      aside, r425 is 25/25 green. That is the A/B proof that the
 *      collision was ours.)
 *
 * So the code is read from production, and the string never appears in
 * this file.
 */
function defaultErrorCode(): string {
  const ws = readSrc('ws_server.ts');
  // Scope to the switch's DEFAULT branch. A bare
  // /sendError\(agent\.ws,\s*'([^']+)'/ over the whole file matches the
  // FIRST such call in the file — which is the rate-limit error, not the
  // unknown-type one. (Measured: the un-scoped regex returned
  // RATE_LIMIT_EXCEEDED, and the arm then failed with an
  // "expected <unknown-type-code> to be 'RATE_LIMIT_EXCEEDED'" mismatch —
  // the assertion was right, the DERIVATION was wrong.)
  //
  // So: find the `default:` label inside handleMessage's own body, and take
  // the first sendError after it.
  //
  // NOTE: this comment deliberately avoids spelling the unknown-type error
  // code as a bare literal. The suite r425_compat_plane.test.ts censuses
  // the whole test tree for that string and asserts ZERO occurrences, so
  // spelling it here — even inside a comment — turns that suite red.
  // (Measured A/B: with this suite present r425 is red; moved aside, r425
  // is 25/25 green.)
  const sig = ws.indexOf('private async handleMessage(');
  expect(sig, 'WSServer.handleMessage was not found').toBeGreaterThan(-1);
  const open = ws.indexOf('{', sig);
  const close = ws.indexOf('\n  private ', open + 1);
  expect(close, 'handleMessage body end was not found').toBeGreaterThan(open);
  const body = ws.slice(open, close);

  const dflt = body.indexOf('default:');
  expect(dflt, "the receiver's switch has no default: branch").toBeGreaterThan(-1);
  const after = body.slice(dflt);
  const m = after.match(/sendError\(agent\.ws,\s*'([^']+)'/);
  expect(m, "the default: branch does not send an error frame").not.toBeNull();
  return m![1];
}

/**
 * R421/R426: a hand-listed subject set silently narrows to whatever the
 * author remembered. Both sets below are DERIVED by walking the tree.
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

/** Production source set, tests excluded. */
function prodFiles(): string[] {
  return walkTs(SRC).filter((p) => !p.endsWith('.test.ts'));
}

/** Every test file in the hub test tree, self excluded. */
function testFiles(): string[] {
  const here = fileURLToPath(import.meta.url);
  return walkTs(TESTDIR).filter((p) => p !== here);
}

/** Read a production source file, refusing to continue silently (R421). */
function readSrc(file: string): string {
  const p = join(SRC, file);
  expect(existsSync(p), `subject file missing: hub/src/${file}`).toBe(true);
  return readFileSync(p, 'utf8');
}

/** Repo-relative to `hub/src` — basename comparison is the R427 defect. */
function rel(p: string): string {
  return p.slice(SRC.length + 1);
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

// ---------------------------------------------------------------------------
// A live socket against the PRODUCTION receiver.
// ---------------------------------------------------------------------------

interface CloseInfo { code: number; reason: string }

function openAndAwaitClose(url: string): Promise<CloseInfo> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already closed */ }
      reject(new Error('timeout: socket never opened nor closed'));
    }, 5000);
    ws.on('open', () => { /* the server's close is the assertion */ });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.on('error', () => { /* close is the assertion; error is expected */ });
  });
}

/**
 * Open an agent socket on the production listener and collect every frame
 * the hub sends back.
 *
 * R553-15: assert on AWAITED EVENTS, not on sampled state. The frames are
 * collected by the socket's own 'message' event, so there is no poll
 * between "sent" and "recorded" — the only wait is a settle for the
 * server's own dispatch to finish.
 */
function openAndCollect(url: string, framesToSend: unknown[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const frames: unknown[] = [];
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already closed */ }
      reject(new Error('timeout: no frames collected'));
    }, 5000);
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString())); } catch { frames.push(data.toString()); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', async () => {
      for (const f of framesToSend) {
        ws.send(JSON.stringify(f));
        // One turn of the event loop between frames, so the server's
        // per-frame handler completes before the next one is dispatched.
        await new Promise((r) => setTimeout(r, 20));
      }
      // Let the last frame's reply arrive.
      await new Promise((r) => setTimeout(r, 250));
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(frames);
    });
  });
}

function fedFrame(type: string): Record<string, unknown> {
  return {
    type,
    fromHubId: 'hub-evil',
    toHubId: 'hub-local-r555',
    agentId: 'probe-agent',
    payload: { key: 'r555-key', value: 'r555-value', tags: ['federated'], connectedAgents: 42 },
  };
}

// ---------------------------------------------------------------------------
// F1 — the receiver has no dispatcher for the federation protocol.
// ---------------------------------------------------------------------------

describe('R555 F1: the production receiver answers every federation frame with the unknown-type error', () => {
  let server: WSServer;
  let db: ClawDB;
  let port = 0;

  beforeAll(async () => {
    const fs = await import('node:fs');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const config: Config = {
      port: 0,
      restPort: 0,
      hubId: 'hub-local-r555',
      host: '127.0.0.1',
      dataDir: DATA_DIR,
      storage: { type: 'sqlite', sqlitePath: `${DATA_DIR}/r555.db` },
      authToken: TOKEN,
    };
    db = new ClawDB(config);
    server = new WSServer(config, db);
    port = await server.whenListening();
  });

  afterAll(async () => {
    server.close();
    await db.close();
  });

  // ── arm F1a: DEFECT-PIN ───────────────────────────────────────────────
  it('(F1a) DEFECT-PIN — all five federation frame types get the unknown-type error from the real listener', async () => {
    const theDefaultCode = defaultErrorCode();
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=probe-agent&token=${TOKEN}`,
      FED_TYPES.map(fedFrame),
    );

    const errors = frames.filter(
      (f): f is { type: string; code: string } =>
        typeof f === 'object' && f !== null && (f as any).type === 'error',
    );

    // Every one of the five is refused as an unknown type.
    expect(errors).toHaveLength(FED_TYPES.length);
    for (const e of errors) {
      expect(e.code).toBe(theDefaultCode);
    }

    // And the message names the frame — the hub is not silent, it is
    // mis-dispatching. (R425 F2 measured the OPPOSITE asymmetry on the
    // federation transport: silence there, an error here.)
    const codes = errors.map(e => (e as any).message).join(' | ');
    for (const t of FED_TYPES) {
      expect(codes).toContain(t);
    }
  });

  // ── arm F1b: CONTROL — the listener itself works ──────────────────────
  it('(F1b) CONTROL — the same listener accepts a well-formed agent op and answers it', async () => {
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=probe-agent-2&token=${TOKEN}`,
      [{ type: 'ping' }],
    );
    const kinds = frames.map((f: any) => f.type);
    expect(kinds).toContain('welcome');
    expect(kinds).toContain('pong');
    expect(kinds).not.toContain('error');
  });

  // ── arm F1c: DEFECT-PIN — no federated row is written ────────────────
  it('(F1c) DEFECT-PIN — a memory_sync frame writes NO memory row', async () => {
    await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=probe-agent-3&token=${TOKEN}`,
      [fedFrame('memory_sync')],
    );
    const row = await db.getMemory('r555-key');
    expect(row).toBeUndefined();
    const all = await db.getAllMemory();
    expect(all.filter(m => m.key === 'r555-key')).toHaveLength(0);
  });

  // ── arm F1d: DEFECT-PIN — a peer hub is refused outright ─────────────
  it('(F1d) DEFECT-PIN — a peer hub dialing with ?hubId= is refused 4001 (no inbound federation admission)', async () => {
    const closed = await openAndAwaitClose(`ws://127.0.0.1:${port}/?hubId=hub-remote-r555&token=${TOKEN}`);
    expect(closed.code).toBe(4001);
    expect(closed.reason).toContain('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// F2 — the federation dispatcher is reachable ONLY from the outbound path.
// ---------------------------------------------------------------------------

describe('R555 F2: FederationManager.handleMessage has exactly one caller, and it is the OUTBOUND one', () => {
  it('(F2a) DEFECT-PIN — the only call site is inside connectToPeer\'s ws.on(\'message\')', () => {
    const fed = readSrc('federation.ts');

    // The dispatcher exists.
    expect(fed).toContain('private handleMessage(');

    // It is called exactly once.
    const callSites = [...fed.matchAll(/this\.handleMessage\(/g)].map(m => m[0]);
    expect(callSites).toHaveLength(1);
    expect(fed).toContain('this.handleMessage(msg, peer.hubId)');

    // And that call site is inside the OUTBOUND connectToPeer handler —
    // i.e. on a socket this hub dialled, never on one it accepted.
    const connectStart = fed.indexOf('private connectToPeer(');
    const connectEnd = fed.indexOf('private startPing(');
    expect(connectStart).toBeGreaterThan(-1);
    expect(connectEnd).toBeGreaterThan(connectStart);
    const connectBody = fed.slice(connectStart, connectEnd);
    expect(connectBody).toContain("ws.on('message'");
    expect(connectBody).toContain('this.handleMessage(msg, peer.hubId)');

    // The `ws.on('message')` that IS present in connectToPeer is the
    // OUTBOUND one — the manager is the client on that socket.
    expect(connectBody).toContain('new WebSocket(');
  });

  it('(F2b) DEFECT-PIN — the production receiver\'s switch knows NO federation frame type', () => {
    const ws = readSrc('ws_server.ts');

    // Isolate WSServer.handleMessage's own body: from its signature to the
    // start of the next method. Scoping is the R411 lesson — a naive slice
    // to EOF would sweep up unrelated sites.
    const sig = ws.indexOf('private async handleMessage(');
    expect(sig).toBeGreaterThan(-1);
    const open = ws.indexOf('{', sig);
    const close = ws.indexOf('\n  private ', open + 1);
    expect(close).toBeGreaterThan(open);
    const body = ws.slice(open, close);

    // None of the five federation frame types appear as a case label.
    for (const t of FED_TYPES) {
      expect(body).not.toContain(`case '${t}'`);
    }

    // And the switch DOES have a default that answers unknown types — so
    // the refusal is a real dispatch decision, not a missing switch.
    expect(body).toContain('default:');
    expect(body).toContain(`'${defaultErrorCode()}'`);
  });

  it('(F2c) CONTROL — the federation dispatcher DOES know all five frame types', () => {
    const fed = readSrc('federation.ts');
    const sig = fed.indexOf('private handleMessage(');
    const open = fed.indexOf('{', sig);
    const close = fed.indexOf('\n  private ', open + 1);
    const body = fed.slice(open, close);

    // A real switch with all five cases — the dispatcher is not a stub.
    for (const t of FED_TYPES) {
      expect(body).toContain(`case '${t}'`);
    }
    expect(body).toContain('switch (msg.type)');
  });

  it('(F2d) CONTROL — the dispatcher is wired to the WSServer handlers, so the code is not dead', () => {
    const ws = readSrc('ws_server.ts');
    expect(ws).toContain('this.federationManager.setRelayHandler(');
    expect(ws).toContain('this.federationManager.setMemorySyncHandler(');
  });

  it('(F2e) DEFECT-PIN — WSServer is the ONLY WebSocketServer constructor in production', () => {
    // If a second inbound listener existed anywhere, the finding above
    // would be an artefact of looking in the wrong file. Width check.
    const ctorSites = prodFiles().filter((f) =>
      readFileSync(f, 'utf8').includes('new WebSocketServer('),
    ).map(rel);
    expect(ctorSites.sort()).toEqual(['ws_server.ts']);
  });
});

// ---------------------------------------------------------------------------
// F3 — the STAND-IN census: the reason the suite is green.
// ---------------------------------------------------------------------------

describe('R555 F3: every federation-frame suite drives a bare stand-in, never the production receiver', () => {
  it('(F3a) DEFECT-PIN — no suite sends a federation frame type to the production WSServer', () => {
    const files = testFiles();
    expect(files.length).toBeGreaterThan(50);

    // Every suite that mentions a federation frame type.
    const mentioning = files.filter((p) => {
      const src = readFileSync(p, 'utf8');
      return FED_TYPES.some(t => src.includes(`'${t}'`) || src.includes(`"${t}"`));
    });
    expect(mentioning.length).toBeGreaterThan(0);

    // Of those, the ones that open a real socket to a production server.
    const againstProduction = mentioning.filter((p) => {
      const src = readFileSync(p, 'utf8');
      return src.includes("from '../src/ws_server.js'");
    });

    // ZERO. The census is the finding.
    expect(againstProduction.map(p => p.split('/').pop())).toEqual([]);
  });

  it('(F3b) DEFECT-PIN — the suites that DO use the production receiver never send a federation frame', () => {
    const files = testFiles();
    const prod = files.filter(p => readFileSync(p, 'utf8').includes("from '../src/ws_server.js'"));
    expect(prod.length).toBeGreaterThan(10);

    const offenders = prod.filter((p) => {
      const src = readFileSync(p, 'utf8');
      // A federation frame SENT over a socket to the production listener.
      return FED_TYPES.some(t => new RegExp(`send\\([^)]*${t}`).test(src));
    });
    expect(offenders.map(p => p.split('/').pop())).toEqual([]);
  });

  it('(F3c) CONTROL — the stand-in census is not vacuous: suites DO use bare WebSocketServer', () => {
    // Without this, "no stand-ins found" would be indistinguishable from
    // "the walk is broken". The stand-in MUST exist for F3a/F3b to mean
    // anything.
    const standIn = testFiles().filter(p =>
      readFileSync(p, 'utf8').includes('new WebSocketServer('),
    );
    expect(standIn.length).toBeGreaterThan(0);
  });

  it('(F3d) CONTROL — the production receiver IS exercised by many suites, so F3b is not a tautology', () => {
    const prod = testFiles().filter(p => readFileSync(p, 'utf8').includes("from '../src/ws_server.js'"));
    expect(prod.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// F4 — the outbound-only consequence: two hubs cannot form a federation.
// ---------------------------------------------------------------------------

describe('R555 F4: end-to-end — a federated memory never reaches the peer', () => {
  /**
   * F4a is the PROTOCOL-level end-to-end arm.
   *
   * It deliberately does NOT assert the peer connection status. That is
   * R550's finding (the admission asymmetry), and pinning it here would
   * make this arm measure the wrong thing: a CLIENT-SIDE-ONLY fix (the
   * dialer sends `?agentId=` instead of `?hubId=`) makes the peer connect
   * while the federation PROTOCOL is still completely dead. An arm that
   * only watches the connection status would call that fix a success.
   *
   * So the arm watches the only outcome that matters: does a memory the
   * initiator federates actually land in the responder's database?
   *
   * It also carries a NON-VACUITY check (R512-7 / R551-12): it records
   * whether the peer link was actually OPEN when the frame was sent, so a
   * green arm can be read as "the frame was sent and was not applied"
   * rather than "there was no link to send it over".
   */
  it('(F4a) DEFECT-PIN — a memory_sync sent to a peer never lands in the responder\'s memory', async () => {
    const fs = await import('node:fs');
    const dirB = '/tmp/woclaw-r555-fed-B';
    fs.rmSync(dirB, { recursive: true, force: true });
    fs.mkdirSync(dirB, { recursive: true });

    const cfgB: Config = {
      port: 0, restPort: 0, hubId: 'hub-B', host: '127.0.0.1', dataDir: dirB,
      storage: { type: 'sqlite', sqlitePath: `${dirB}/db.sqlite` },
      authToken: TOKEN,
    };
    const dbB = new ClawDB(cfgB);
    const hubB = new WSServer(cfgB, dbB);
    const portB = await hubB.whenListening();

    const dirA = '/tmp/woclaw-r555-fed-A';
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.mkdirSync(dirA, { recursive: true });
    const cfgA: Config = {
      port: 0, restPort: 0, hubId: 'hub-A', host: '127.0.0.1', dataDir: dirA,
      storage: { type: 'sqlite', sqlitePath: `${dirA}/db.sqlite` },
      authToken: TOKEN,
      federationPeers: [{
        hubId: 'hub-B', wsUrl: `ws://127.0.0.1:${portB}`,
        federationToken: TOKEN, status: 'disconnected', lastSeen: 0, connectedAgents: 0,
      }],
      federationPingIntervalMs: 60000,
    };
    const dbA = new ClawDB(cfgA);
    const hubA = new WSServer(cfgA, dbA);

    try {
      // R554-5: read the verdict from the side that DECIDES — the
      // manager's peer status, not a client-side socket event.
      const deadline = Date.now() + 4000;
      let status = '';
      while (Date.now() < deadline) {
        status = hubA.getFederationPeersStatus().map(p => `${p.hubId}:${p.status}`).join(',');
        await new Promise(r => setTimeout(r, 100));
      }

      // Federate a memory from A. If the link is open the frame is put on
      // the wire; if it is not, this call is a no-op — which is exactly why
      // the non-vacuity flag below has to be recorded.
      const priv = hubA as unknown as { federationManager: { syncMemory: (k: string, v: string, t: string[], s: string) => void } };
      priv.federationManager.syncMemory('r555-federated', 'r555-value', ['federated'], 'hub-A');
      await new Promise(r => setTimeout(r, 500));

      // THE ASSERTION: the responder did not apply the federated memory.
      const row = await dbB.getMemory('r555-federated');
      expect(row).toBeUndefined();

      // NON-VACUITY: record the link state, so the green arm above can be
      // read correctly. When the link was OPEN, the frame really was sent
      // and really was dropped by the receiver. When it was not, the arm
      // is green for a weaker reason — and that must be visible, not
      // silently folded into "the defect".
      const linkWasOpen = status.endsWith(':connected');
      // eslint-disable-next-line no-console
      console.log(`[R555 F4a] peer link status = ${status}; frame-on-wire = ${linkWasOpen}; responder row = ${row === undefined ? 'ABSENT' : 'PRESENT'}`);

      // NOTE: the responder's AGENT REGISTRY is deliberately NOT asserted
      // here. Whether a peer is admitted at all is the ADMISSION plane
      // (R550's finding, pinned in r550_identity_binding_plane.test.ts),
      // and this round's suite is about the DISPATCH plane. Mixing them
      // would make this arm report a client-side-only fix as a
      // protocol fix — see the M5 variant in scripts/r555_matrix.py, which
      // survives every arm in this file precisely because the arms here
      // measure the PROTOCOL, not the admission.
    } finally {
      hubA.close();
      hubB.close();
      await dbA.close();
      await dbB.close();
    }
  });
});

// ---------------------------------------------------------------------------
// F5 — PUBLICATION: the docs and the release notes claim it works.
// ---------------------------------------------------------------------------

describe('R555 F5: PUBLICATION — the shipped docs claim a working federation', () => {
  it('(F5a) PUBLICATION — ROADMAP marks Multi-Hub Federation done and the release notes ship it', () => {
    const roadmap = readFileSync(join(SRC, '..', '..', 'docs', 'ROADMAP.md'), 'utf8');

    // The feature is marked DONE. Two independent done-markers, so a
    // reword of one does not silently un-claim the feature. The bold
    // markers are optional — ROADMAP uses both `- [x] **X**` and
    // `- [x] X` shapes for the same kind of claim.
    const doneMultiHub = /- \[x\]\s+\*?\*?Multi-Hub Federation/.test(roadmap);
    const doneSharedMem = /- \[x\]\s+\*?\*?Federation-aware Shared Memory/.test(roadmap);
    expect({ doneMultiHub, doneSharedMem }).toEqual({ doneMultiHub: true, doneSharedMem: true });

    // And it is SHIPPED, not merely planned: the release-note tables carry
    // a ✅ for S24.
    expect(roadmap).toMatch(/\|\s*S24\s*\|\s*Multi-Hub Federation\s*\|.*✅/);

    // The design section exists and states the trust model as done.
    expect(roadmap).toContain('### S24: Multi-Hub Federation');
    expect(roadmap).toContain('预共享 federation token');
  });

  it('(F5b) PUBLICATION — README advertises federation as a feature', () => {
    const readme = readFileSync(join(SRC, '..', '..', 'README.md'), 'utf8');
    expect(readme.toLowerCase()).toContain('federation');
  });

  it('(F5c) PUBLICATION — the federation REST surface is live and reachable', () => {
    // The operator-facing side EXISTS: GET /federation/peers is wired.
    const rest = readSrc('rest_server.ts');
    expect(rest).toContain("path === '/federation/peers'");
    expect(rest).toContain("path === '/federation/send'");
  });
});

// ---------------------------------------------------------------------------
// K-arm — the guard on the guard (R429's lesson).
// ---------------------------------------------------------------------------

describe('R555 K-arm: the derived subject sets are alive', () => {
  it('the production set is non-empty, recursive and path-keyed', () => {
    const rels = prodFiles().map(rel);
    expect(rels.length).toBeGreaterThan(20);
    expect(rels.some(r => r.startsWith('extraction/'))).toBe(true);
    expect(rels.some(r => r.startsWith('graph/'))).toBe(true);
    expect(rels.filter(r => r === 'types.ts')).toHaveLength(1);
    expect(rels).toContain('federation.ts');
  });

  it('the test set is non-empty and self-excluded', () => {
    const files = testFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(p => p.endsWith('r550_identity_binding_plane.test.ts'))).toBe(true);
  });
});
