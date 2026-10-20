/**
 * R476 — the hub records that a message EXISTED. It never records that it
 * ARRIVED.
 *
 * -----------------------------------------------------------------------
 * SELECTION. Queued by R475.15: "R475-F2 found that `send()` has neither a
 * bound nor an observability property — combine the missing ceiling with the
 * R444 observability conclusion into one arm: the slow consumer is
 * INVISIBLE." R475 owned the ceiling (fanout is unbounded). This round owns
 * the other half, which R475 explicitly did not: **the outcome of the
 * fanout**.
 *
 * R466-independence check (R475.15 required it): R466 measured whether two
 * *failure predicates over a derived subject set* are independent, by set
 * containment. This round asserts no failure predicate over any shared
 * upstream — every arm here either measures an outbound frame this round
 * caused, or reads a schema DDL. There is no shared `ROUNDED` set, no
 * `citedBy`, no suite imports another suite's logic. Not a re-run.
 *
 * -----------------------------------------------------------------------
 * A. THE SHAPE, FROM THE FILES
 *
 * `handleChatMessage` (ws_server.ts:419-448) performs exactly four effects,
 * in this order:
 *
 *     const message = { id: uuidv4(), ... };
 *     await this.db.saveMessage({...});            // (1) DURABLE, no outcome
 *     const recipients = this.topics.broadcast(topic, message);
 *     for (const agentId of recipients) {
 *       const agent = this.agents.get(agentId);
 *       if (agent && agent.ws.readyState === 1) this.send(agent.ws, message);
 *     }                                            // (2) the fanout
 *     const sender = this.agents.get(fromAgent);
 *     if (sender && sender.ws.readyState === 1)
 *       this.send(sender.ws, { ...message, sent: true });   // (3) THE ACK
 *
 * `send` (ws_server.ts:594-598) is:
 *
 *     private send(ws: WS, msg: OutboundMessage): void {
 *       if (ws.readyState === 1) { ws.send(JSON.stringify(msg)); }
 *     }
 *
 * Three consequences, each measured below rather than argued:
 *
 *   F1  (1) is UNCONDITIONAL and (2) may deliver to nothing. `broadcast`
 *        (topics.ts:130-141) returns `[]` when the topic does not exist, and
 *        returns only ids that pass `agentId !== excludeAgent`. Nothing
 *        consults `recipients` before (1) commits. So a message with
 *        **provably zero recipients** is durably stored and acknowledged.
 *
 *   F2  (3) is minted with no relation to (2). The ack carries the message
 *        verbatim plus `sent: true`. It names no recipient, no count, no
 *        failure. Two broadcasts of different fanout widths produce
 *        acknowledgements that are byte-identical apart from the id.
 *
 *   F3  the plane is not merely unenforced, it is **not expressible**: the
 *        `messages` table is (id, topic, from_agent, content, timestamp) in
 *        BOTH backends (db.ts:441-447 SQLite, :1027-1034 MySQL). There is no
 *        recipient column, no `delivered_to`, no receipts table. A message
 *        row cannot record who received it. (R395/R399 shape.)
 *
 *   F4  the one boolean in the delivery path already exists and already
 *        means something ELSE. `sendToAgent` (ws_server.ts:718-723) returns
 *        `false` iff the agent is absent or the socket is not OPEN — i.e. it
 *        reports ADMISSION, not delivery. Its single truth-checking caller
 *        (`POST /delegations`, rest_server.ts:883-895) reads it as delivery
 *        and sets `status='rejected'`. `handleChatMessage` never consults any
 *        boolean. So `delivered` is one word, two meanings, and the path with
 *        real fanout has neither.
 *
 * -----------------------------------------------------------------------
 * ARMS — assert CURRENT behaviour, GREEN at HEAD, descriptions not demands.
 *
 *   A  NEGATIVE CONTROL: the walker detects vocabularies known to exist, so
 *      every zero below is a fact about the source, not about the probe
 *      (R405 / R475-A).
 *   B  F1 measured: a broadcast with provably ZERO live recipients is
 *      persisted AND acknowledged `sent: true`.
 *   C  F2 measured: acknowledgements for a 1-member and an N-member broadcast
 *      are identical apart from the message id — the ack carries no fanout
 *      outcome.
 *   D  F4 measured: `sendToAgent`'s boolean is an ADMISSION signal — a
 *      connected-but-slow peer still returns true, and the chat path has no
 *      boolean at all. So the ack's `sent` is not derived from a delivery
 *      decision.
 *   E  F3 shape: `messages` carries no per-recipient column in either
 *      backend ⇒ the outcome is unrepresentable, not merely unrecorded.
 *   F  NEGATIVE CONTROL the other way: a non-zero outcome signal DOES exist
 *      on the delegation path (`POST /delegations` → `status:'rejected'`),
 *      so B/C/D are not "the hub has no failure vocabulary anywhere".
 *
 * The repair — a per-recipient delivery ledger, a recipient count on the
 * ack, or an at-least-once redelivery contract — is a **behaviour decision**
 * and is **father-gated**. This suite only pins the shape.
 *
 * A repair turns one arm RED on purpose (R475-3: a suite that pins an absence
 * must carry a repair mutant, or it does not detect the thing it describes).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config, InboundMessage } from '../src/types.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, '..', 'src');

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r476-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r476-probe/probe.db' },
  authToken: 'r476-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Strip block + line comments so a census never reads prose as code (R460-3). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function srcFiles(): string[] {
  return readdirSync(SRC).filter(f => f.endsWith('.ts')).sort();
}

describe('R476: the message is durable before it is delivered, and nothing records the delivery', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let wsPort: number, restPort: number;
  const opened: WebSocket[] = [];

  beforeAll(async () => {
    rmSync(CFG.dataDir!, { recursive: true, force: true });
    mkdirSync(CFG.dataDir!, { recursive: true });
    db = new ClawDB(CFG);
    ws = new WSServer(CFG, db);
    const mem = ws.getMemoryPool();
    mem.graphStore = new GraphStore();
    rest = new RestServer(CFG, db, ws.getTopicsManager(), mem, mem.graphStore, ws);
    await rest.start();
    wsPort = await ws.whenListening();
    restPort = await rest.whenListening();
  });

  afterAll(() => {
    for (const s of opened) { try { s.close(); } catch { /* already gone */ } }
    try { rest.close(); } catch { /* already stopped */ }
    try { ws.close(); } catch { /* already stopped */ }
    rmSync(CFG.dataDir!, { recursive: true, force: true });
  });

  async function connect(agentId: string): Promise<WebSocket> {
    const s = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=${agentId}&token=${CFG.authToken}`);
    opened.push(s);
    await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    return s;
  }

  function joinTopic(s: WebSocket, topic: string): Promise<boolean> {
    return new Promise((res) => {
      const t = setTimeout(() => res(false), 2000);
      s.on('message', (raw) => {
        let m: any;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m?.type === 'history' && m?.topic === topic) { clearTimeout(t); res(true); }
      });
      s.send(JSON.stringify({ type: 'join', topic } as InboundMessage));
    });
  }

  /** Publish one message; resolve with the SENDER'S acknowledgement frame. */
  function publish(s: WebSocket, topic: string, content: string): Promise<any> {
    return new Promise((res) => {
      const t = setTimeout(() => res(null), 2500);
      s.on('message', (raw) => {
        let m: any;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m?.sent === true) { clearTimeout(t); res(m); }
      });
      s.send(JSON.stringify({ type: 'message', topic, content } as InboundMessage));
    });
  }

  /** Read a topic back over REST — the persisted record, independent of any socket. */
  async function persisted(topic: string): Promise<any[]> {
    // The read path is GET /topics/:topic (rest_server.ts:330-332 -> handleTopicMessages,
    // :1333-1341); there is no /messages route. Pinned to the real route so B's
    // durability claim cannot be satisfied by a 404 handler returning [].
    const res = await fetch(`http://127.0.0.1:${restPort}/topics/${encodeURIComponent(topic)}?token=${CFG.authToken}`);
    expect(res.status, `GET /topics/${topic} must be served, not 404`).toBe(200);
    const body = await res.json() as any;
    return body?.messages ?? [];
  }

  // ────────────────────────────────────────────────────────────────────────
  // A — NEGATIVE CONTROL. Without this, the zero in arm E is uninterpretable.
  // ────────────────────────────────────────────────────────────────────────
  it('A the walker detects the vocabularies that DO exist, so its zero on the subject is evidence', () => {
    const files = srcFiles();
    expect(files.length, 'src/ must not be empty — the walker reached the tree').toBeGreaterThan(0);

    const controls: Record<string, RegExp> = {
      'the fanout loop':   /broadcast/i,
      'the recipient set': /recipients/i,
      'the send primitive': /\.send\(/,
    };
    const counts: Record<string, number> = {};
    for (const [label, re] of Object.entries(controls)) {
      let n = 0;
      for (const f of files) {
        n += (stripComments(readFileSync(join(SRC, f), 'utf8')).match(new RegExp(re.source, 'gi')) || []).length;
      }
      counts[label] = n;
    }
    expect(counts['the fanout loop'], 'control: the fanout exists').toBeGreaterThan(0);
    expect(counts['the recipient set'], 'control: a recipient set is computed').toBeGreaterThan(0);
    expect(counts['the send primitive'], 'control: send() is called').toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // B — F1, MEASURED. Persistence precedes the fanout and is not conditioned
  // on it, so "stored" and "delivered" are independent facts.
  // ────────────────────────────────────────────────────────────────────────
  it('B a broadcast with provably ZERO live recipients is persisted AND acknowledged sent:true', async () => {
    const s = await connect('r476-nobody');
    // A topic that exists in NO topic manager: `broadcast` returns [] for it,
    // so the recipient loop provably executes zero times.
    const topic = 'r476-topic-that-does-not-exist';

    const ack = await publish(s, topic, 'into the void');
    expect(ack, 'the sender MUST be acknowledged').not.toBeNull();
    expect(ack.sent, 'and the acknowledgement claims success').toBe(true);

    // The message names no recipient, no count, and no failure.
    const outcomeFields = Object.keys(ack).filter(k =>
      /recipient|delivery|delivered|drop|fail|error|count|acked|reach/i.test(k));
    expect(outcomeFields,
      `the ack must carry no fanout-outcome field; found ${JSON.stringify(outcomeFields)}`)
      .toEqual([]);

    // And the zero-delivery message is nonetheless durable, readable over a
    // transport that has nothing to do with the socket.
    await sleep(200);
    const rows = await persisted(topic);
    expect(rows.length, 'the undelivered message is still in the record').toBe(1);
    expect(rows[0].content).toBe('into the void');

    try { s.close(); } catch { /* gone */ }
    await sleep(150);
  });

  // ────────────────────────────────────────────────────────────────────────
  // C — F2, MEASURED. The ack does not vary with the fanout width. Two
  // broadcasts that reached 1 and N recipients are indistinguishable to the
  // sender, because the ack is minted from `message`, not from `recipients`.
  // ────────────────────────────────────────────────────────────────────────
  it('C acknowledgements are identical for a 1-member and an N-member broadcast — the ack carries no outcome', async () => {
    // Widest fanout we can build: one broadcaster, N listeners.
    const N = 4;
    const broadcaster = await connect('r476-c-sender');
    const listeners: WebSocket[] = [];
    for (let i = 0; i < N; i++) {
      const l = await connect(`r476-c-listener-${i}`);
      listeners.push(l);
      expect(await joinTopic(l, 'r476-c-wide'), `listener ${i} joins`).toBe(true);
    }
    // And the narrowest: a second broadcaster alone in its own topic.
    const solo = await connect('r476-c-solo');
    expect(await joinTopic(solo, 'r476-c-narrow'), 'solo joins its own topic').toBe(true);

    // Collect the frames the wide broadcast ACTUALLY puts on each listener, so
    // the non-vacuity claim below rests on this round's own outbound frames.
    const gotWide: boolean[] = listeners.map(() => false);
    listeners.forEach((l, i) => l.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m?.type === 'message' && m?.topic === 'r476-c-wide') gotWide[i] = true;
    }));

    const wideAck = await publish(broadcaster, 'r476-c-wide', 'identical');
    const narrowAck = await publish(solo, 'r476-c-narrow', 'identical');
    expect(wideAck, 'the wide broadcast is acknowledged').not.toBeNull();
    expect(narrowAck, 'the narrow broadcast is acknowledged').not.toBeNull();

    // Strip only the fields that MUST differ — the identity of the message,
    // the topic it names, and the sender it is attributed to (two different
    // agents sent these, so `from` cannot match by construction) — and assert
    // that everything else is byte-identical. If delivery were reported, this
    // pair would have to differ.
    //
    // The VALUES are compared, not just the key names. R476's own mutation
    // matrix caught the weaker form: a mutation that added `recipients: 4` to
    // the ack left a key-NAMES-only comparison green, because both acks then
    // carried the same extra key. The shape had changed and the pair still
    // "matched". R437: the subject a detector compares must be the subject the
    // claim is about.
    const { id: _idW, topic: _tpW, timestamp: _tsW, from: _fw, ...wideRest } = wideAck;
    const { id: _idN, topic: _tpN, timestamp: _tsN, from: _fn, ...narrowRest } = narrowAck;
    const canon = (o: Record<string, unknown>) =>
      JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    expect(canon(wideRest),
      `an ack reaching ${N} listeners must be byte-identical to one reaching 0`)
      .toBe(canon(narrowRest));

    // The reach really did differ — otherwise C would be vacuous. The wide
    // broadcast really reached the listeners whose frames we just counted,
    // while the narrow one had provably no member besides its sender.
    await sleep(200);
    const reached = gotWide.filter(Boolean).length;
    expect(reached, 'the listeners must be live and reachable — C must not be vacuous')
      .toBeGreaterThanOrEqual(N - 1);

    for (const s of [broadcaster, solo, ...listeners]) { try { s.close(); } catch { /* gone */ } }
    await sleep(150);
  });

  // ────────────────────────────────────────────────────────────────────────
  // D — F4, MEASURED. The delivery path's one boolean means ADMISSION, and
  // the fanout path has no boolean at all. So `sent:true` is not derived from
  // a delivery decision anywhere.
  // ────────────────────────────────────────────────────────────────────────
  it('D the delivery path has no delivery boolean: sendToAgent reports admission, and the fanout ignores returns', async () => {
    const s = await connect('r476-d-present');
    expect(await joinTopic(s, 'r476-d'), 'agent joins').toBe(true);

    // `sendToAgent` is truthy for a CONNECTED agent — which says the socket
    // was OPEN at call time, nothing about the bytes arriving.
    const delivered: boolean = ws.sendToAgent('r476-d-present', { type: 'message', topic: 'r476-d', content: 'probe' } as any);
    expect(delivered, 'a connected agent passes the delivery gate').toBe(true);

    // ...and falsy for an absent one, which is an ADMISSION fact.
    const absent: boolean = ws.sendToAgent('r476-d-never-connected', { type: 'message' } as any);
    expect(absent, 'an absent agent fails the same gate — the boolean is admission, not delivery').toBe(false);

    // The fanout path has no equivalent: `send` returns void, so there is no
    // value for a caller to have consulted. Pinned from source so the claim
    // does not rest on my reading of a call site.
    const wsSrc = readFileSync(join(SRC, 'ws_server.ts'), 'utf8');
    const sendDecl = /private send\(ws: WS, msg: OutboundMessage\): (\w+)/.exec(wsSrc);
    expect(sendDecl, 'the send declaration must be findable').not.toBeNull();
    expect(sendDecl![1], 'send() must return void — the fanout cannot learn an outcome').toBe('void');

    // The ack's `sent` literal is set with no reference to a recipient count.
    const ackSite = wsSrc.slice(wsSrc.indexOf('{ ...message, sent: true }') - 200, wsSrc.indexOf('{ ...message, sent: true }') + 60);
    expect(/recipients\s*\.\s*(length|size)/.test(ackSite),
      'the ack must not be derived from the recipient count')
      .toBe(false);

    try { s.close(); } catch { /* gone */ }
    await sleep(150);
  });

  // ────────────────────────────────────────────────────────────────────────
  // E — F3, SHAPE. The outcome is unrepresentable, not merely unrecorded:
  // no per-recipient column exists in either backend, so a message row cannot
  // say who received it.
  // ────────────────────────────────────────────────────────────────────────
  it('E the messages record carries no per-recipient outcome in EITHER backend — the plane is unrepresentable', () => {
    const dbSrc = readFileSync(join(SRC, 'db.ts'), 'utf8');

    // Both DDLs, located by their own CREATE statements rather than by a line
    // number (R423: a stated line number is not a binding).
    const sqliteDdl = /CREATE TABLE IF NOT EXISTS messages \(([^)]*)\)/.exec(dbSrc);
    const mysqlDdl = /CREATE TABLE IF NOT EXISTS messages \(([\s\S]*?)\) ENGINE=/.exec(dbSrc);
    expect(sqliteDdl, 'the SQLite messages DDL must be findable').not.toBeNull();
    expect(mysqlDdl, 'the MySQL messages DDL must be findable').not.toBeNull();

    for (const [label, ddl] of [['sqlite', sqliteDdl!], ['mysql', mysqlDdl!]] as const) {
      const cols = ddl[1].split(',')
        .map(c => c.trim().split(/\s+/)[0].replace(/[`"]/g, ''))
        .filter(Boolean);
      const outcomeCols = cols.filter(c =>
        /recipient|delivery|delivered|ack|read|receipt|seen|drop/i.test(c));
      expect(outcomeCols,
        `${label} messages must carry no per-recipient outcome column; found ${JSON.stringify(outcomeCols)}`)
        .toEqual([]);
    }

    // And no side table carries one either: no receipts/deliveries table exists.
    const receiptTables = (stripComments(dbSrc).match(/CREATE TABLE IF NOT EXISTS (\w*(receipt|deliver|delivery)\w*)/gi) || []);
    expect(receiptTables,
      `no delivery-receipt table may exist; found ${JSON.stringify(receiptTables)}`)
      .toEqual([]);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F — NEGATIVE CONTROL, the other direction. An outcome signal DOES exist
  // in the hub, on the delegation path. So B/C/D/E are statements about the
  // CHAT FANOUT PATH, not about a hub that has no failure vocabulary.
  // ────────────────────────────────────────────────────────────────────────
  it('F the hub DOES report a failed delivery on the delegation path — B/C/D/E are path-local, not a hub-wide silence', async () => {
    const res = await fetch(`http://127.0.0.1:${restPort}/delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${CFG.authToken}` },
      body: JSON.stringify({ toAgent: 'r476-f-never-connected', task: { description: 'unreachable' } }),
    });
    const body = await res.json() as any;
    expect(res.status, 'the request itself is served').toBe(200);
    expect(body.status, 'and the outcome IS reported: rejected').toBe('rejected');
    expect(body.note, 'with a note naming the reason').toContain('not connected');

    // Source-side: that signal exists exactly because this path consults the
    // boolean. Pin it so the arm is not satisfied by a hardcoded string.
    const restSrc = readFileSync(join(SRC, 'rest_server.ts'), 'utf8');
    expect(/if\s*\(\s*!\s*delivered\s*\)/.test(stripComments(restSrc)),
      'the rejection must be derived from the sendToAgent boolean, not hardcoded')
      .toBe(true);
  });
});
