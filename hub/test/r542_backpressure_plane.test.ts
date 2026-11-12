/**
 * R542 — the BACKPRESSURE plane (per-connection outbound depth, and what the
 * hub's own liveness probe can actually see).
 *
 * -----------------------------------------------------------------------
 * SELECTION. Queued by R475.15: "`send()` has neither a bound nor an
 * observability property — the slow consumer is INVISIBLE." R475 owned the
 * ceiling on FANOUT WIDTH (N recipients per message). R476 owned the
 * OUTCOME (the ack names no recipient; the `messages` table has no
 * `delivered_to` column). Neither owns:
 *
 *   (1) the DEPTH of a single connection's outbound backlog, and
 *   (2) whether the hub's own liveness mechanism can observe that backlog.
 *
 * This round owns those two, and they turn out to be the same defect seen
 * from two sides: a hub that cannot bound or see its own backlog also
 * cannot decide that a peer is gone.
 *
 * R475/R476 INDEPENDENCE CHECK. R475's subject = "N agents each get their
 * own rate-limit budget" (a COUNT of admitted senders). R476's subject =
 * "the ack does not name a recipient" (a SHAPE of a durable record). This
 * round's subject = "bytes queued on ONE socket, and the ORDER in which the
 * hub's control frames reach that socket". No arm here reads the `messages`
 * table, no arm counts recipients, no arm asserts anything about the ack's
 * fields. R475/R476 measure the SEND side's accounting; this measures the
 * SOCKET's transport state.
 *
 * -----------------------------------------------------------------------
 * A. THE SHAPE, FROM THE FILES
 *
 * `send` (ws_server.ts:594-598) is the single outbound chokepoint:
 *
 *     private send(ws: WS, msg: OutboundMessage): void {
 *       if (ws.readyState === 1) {
 *         ws.send(JSON.stringify(msg));
 *       }
 *     }
 *
 * `ws.send()` is a fire-and-forget write into the socket. The `ws` library
 * documents a `'drain'` event for exactly this situation — but `ws` exposes
 * NO `'drain'` event on the WebSocket object (verified in
 * node_modules/ws/lib: the only `'drain'` is `Receiver`'s, an internal
 * socket-level signal that is not re-emitted on the WebSocket).
 *
 * The only backlog signal `ws` provides is `bufferedAmount`:
 *
 *     get bufferedAmount() {
 *       if (!this._socket) return this._bufferedAmount;
 *       return this._socket._writableState.length + this._sender._bufferedBytes;
 *     }
 *
 * The hub never reads it. Arm A shows the entire backpressure vocabulary is
 * absent from hub/src.
 *
 * THE SHARP PART. The hub's liveness mechanism is `pingAll()`, every 30s
 * (ws_server.ts:137-139, 682-691), which calls `ws.ping()`. `ws.ping()`
 * writes a CONTROL frame onto the SAME socket, in the SAME stream, after
 * whatever data frames were already written. So on a congested socket the
 * ping is delivered AFTER the backlog it exists to probe: the liveness
 * check cannot see the condition it was built to detect. The same is true
 * of the CLOSE frame — the eviction signal is queued behind the data
 * traffic it was meant to abort.
 *
 * `handleConnection` never registers a `'pong'` listener
 * (ws_server.ts:195-214 registers 'message', 'close', 'error' only), so
 * there is no pong-based liveness signal either.
 *
 * -----------------------------------------------------------------------
 * B. WHAT IS MEASURED (real sockets, real server, real hub send path)
 *
 * A1 (arm A)  census: the backpressure vocabulary is absent from hub/src;
 *              a CONTROL vocabulary (things that DO exist) is detected, so
 *              the zero is evidence rather than a broken scanner.
 * A2 (arm B)  a real peer that stops reading grows the hub's outbound
 *              backlog on THAT socket without bound — driven through the
 *              hub's REAL fanout path (a second peer publishes; the hub
 *              calls its own `send()`), not by writing to the socket
 *              directly.
 * A3 (arm C)  CONTROL: a peer that DOES read receives every message — so
 *              B is not "messages are always lost".
 * A4 (arm D)  the hub's liveness ping, on a congested socket, arrives
 *              AFTER every queued data frame. CONTROL: on the SAME socket,
 *              a ping written BEFORE the backlog arrives FIRST. So the
 *              reordering is caused by the backlog, not by protocol.
 * A5 (arm E)  the hub's own agent inventory reports the congested peer as
 *              live — the backlog is INVISIBLE to the operator.
 * A6 (arm F)  the plane is not expressible: no config knob, no metric, no
 *              schema column for a per-connection backlog.
 * A7 (arm G)  the hub's eviction frame is queued behind the very traffic
 *              it was issued to abort.
 *
 * EVERY ARM IS POLLED, NOT SLEPT (R482-10): a fixed sleep makes an arm a
 * coin flip.
 *
 * MEASUREMENT DISCIPLINE (learned the hard way, first version of this file):
 *   - Arms that exercise the hub's outbound path must drive it through the
 *     hub (a publisher peer), not by calling `ws.send()` on the hub's own
 *     socket object. A repair injected into `send()` is INVISIBLE to a
 *     test that bypasses `send()` — the mutation matrix caught this (M1
 *     survived arm B in v1).
 *   - The census arms (A, F) are SHAPE detectors: they turn red for ANY
 *     occurrence of the subject vocabulary, including one in a COMMENT.
 *     That is why the matrix records their expected red-arm set explicitly
 *     rather than pretending they can distinguish a repair from a mention
 *     (R475-8).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import net from 'net';
import fs from 'fs';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { Config } from '../src/types.js';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function mkTempDir(tag: string): string {
  const dir = `/tmp/woclaw-bp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const TOKEN = 'bp-token-abc';

function baseConfig(dir: string, port: number): Config {
  return {
    port,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    authToken: TOKEN,
    hubId: 'hub-bp-under-test',
  };
}

/** Poll until `fn()` is truthy, or fail after `ms`. Polling, not a fixed
 *  sleep — a fixed sleep makes an arm a coin flip (R482-10). */
async function waitFor(fn: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for: ${what}`);
}

/** The hub's live WebSocket object for a given agent. This is the SAME
 *  object the hub writes on — we read it, we never re-implement it. */
function hubSocket(server: WSServer, agentId: string): WebSocket & {
  bufferedAmount: number;
  _socket?: { _writableState: { length: number } };
  _sender?: { _bufferedBytes: number };
} {
  const agents = (server as unknown as {
    agents: Map<string, { ws: WebSocket }>;
  }).agents;
  const ws = agents.get(agentId)?.ws;
  if (!ws) throw new Error(`no hub socket for agent ${agentId}`);
  return ws as WebSocket & {
    bufferedAmount: number;
    _socket?: { _writableState: { length: number } };
    _sender?: { _bufferedBytes: number };
  };
}

/** A client that records ONLY the frames the hub pushed as topic messages
 *  on topic 't' (tagged), plus control frames (ping / close). The hub's
 *  own 'welcome' frame is deliberately excluded, so the counts below are
 *  about the BACKLOG and not about frames that arrived before the test
 *  started recording.
 *
 *  Pings are recorded WITH THEIR PAYLOAD. `ws.ping(data)` lets the server
 *  tag a control frame, so the two pings in arm D are distinguishable by
 *  identity and not merely by position. */
function recordingClient(port: number, agentId: string): {
  client: WebSocket; opened: Promise<void>;
  order: string[];
} {
  const order: string[] = [];
  const client = new WebSocket(`ws://127.0.0.1:${port}/?agentId=${agentId}&token=${TOKEN}`);
  client.on('message', (d: Buffer) => {
    try {
      const f = JSON.parse(d.toString()) as { type?: string; topic?: string };
      if (f.type === 'message' && f.topic === 't') order.push('data');
    } catch { /* non-JSON */ }
  });
  client.on('ping', (data: Buffer) => {
    const tag = data && data.length ? data.toString() : 'UNTAGGED';
    order.push(`PING:${tag}`);
  });
  client.on('close', (code: number) => order.push(`CLOSE(${code})`));
  const opened = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('open timeout')), 8000);
    client.once('open', () => { clearTimeout(t); resolve(); });
    client.once('error', (e: unknown) => { clearTimeout(t); reject(e); });
  });
  return { client, opened, order };
}

/** A client that reads everything (used for the publisher and the control). */
function drainingClient(port: number, agentId: string): {
  client: WebSocket; opened: Promise<void>; frames: unknown[];
} {
  const frames: unknown[] = [];
  const client = new WebSocket(`ws://127.0.0.1:${port}/?agentId=${agentId}&token=${TOKEN}`);
  client.on('message', (d: Buffer) => { try { frames.push(JSON.parse(d.toString())); } catch { /* non-JSON */ } });
  const opened = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('open timeout')), 8000);
    client.once('open', () => { clearTimeout(t); resolve(); });
    client.once('error', (e: unknown) => { clearTimeout(t); reject(e); });
  });
  return { client, opened, frames };
}

/** One MiB of payload. Large enough that a modest number of them overflows
 *  the kernel socket buffer and reaches a measurable backlog. */
const MB = 1024 * 1024;

/** How many 1 MiB topic messages it takes to push the slow peer's backlog
 *  to a measurable size. MEASURED, not guessed: 12 x 1 MiB already yields
 *  ~9.4 MB of `bufferedAmount` (scratch probe r542-scratch5). */
const BURST = 12;

describe('R542: the backpressure plane — an unbounded per-connection backlog, and a liveness probe queued behind it', () => {
  // These arms move tens of MiB through a real socket and wait for real
  // network drains; the default 10 s vitest timeout is too short.
  const TEST_TIMEOUT = 90_000;

  let db: ClawDB | undefined;
  const servers: WSServer[] = [];
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients) { try { c.terminate(); } catch { /* already dead */ } }
    clients.length = 0;
    for (const s of servers) { try { s.close(); } catch { /* already closed */ } }
    servers.length = 0;
    if (db) await db.close();
    db = undefined;
  });

  /** Bring up a hub with a SLOW peer (socket paused) and a HEALTHY
   *  publisher that both join topic 't'. The publisher drives the hub's
   *  real fanout path. */
  async function setupHubWithSlowPeer(tag: string) {
    const dir = mkTempDir(tag);
    const port = await freePort();
    const d = (db = new ClawDB(dir));
    const server = new WSServer(baseConfig(dir, port), d);
    servers.push(server);

    const slow = recordingClient(port, 'slowpoke');
    clients.push(slow.client);
    await slow.opened;
    (slow.client as unknown as { _socket: net.Socket })._socket.pause();

    const pub = drainingClient(port, 'publisher');
    clients.push(pub.client);
    await pub.opened;

    slow.client.send(JSON.stringify({ type: 'join', topic: 't' }));
    pub.client.send(JSON.stringify({ type: 'join', topic: 't' }));
    await waitFor(
      () => pub.frames.some((f: any) => f && f.type === 'history'),
      8000, 'both peers to join',
    );

    return { server, slow, pub, port };
  }

  /** Publish `count` large messages through the hub. */
  function publishBurst(pub: { client: WebSocket }, count: number) {
    const big = 'x'.repeat(MB);
    for (let i = 0; i < count; i++) {
      pub.client.send(JSON.stringify({ type: 'message', topic: 't', content: big }));
    }
  }

  /** Wait until the hub has actually WROTE all `count` published messages to
   *  the slow peer.
   *
   *  This condition matters and was a bug in v1: `handleChatMessage` is
   *  ASYNC (it awaits `db.saveMessage` before the fanout), so publishing N
   *  messages does NOT mean N frames have been written yet. Issuing the
   *  ping/close straight after the publish therefore raced the fanout —
   *  the control frame was written while only ~half the data frames had
   *  been written, and the arm measured the race instead of the backlog.
   *
   *  The publisher is a member of 't', so it receives one acknowledgement
   *  per published message (`{...message, sent:true}`, ws_server.ts:446-448).
   *  The ack is written AFTER the fanout, so N acks ⇒ the fanout for
   *  those N messages has already happened.
   */
  async function waitForFanoutComplete(
    pub: { frames: unknown[] },
    count: number,
  ): Promise<void> {
    await waitFor(() => {
      const acks = pub.frames.filter((f: any) => f && f.sent === true);
      return acks.length >= count;
    }, 15000, `the hub to fan out ${count} messages`);
  }

  // ------------------------------------------------------------------ A

  it('A the census detects the vocabularies that DO exist, so its zero on the backpressure subject is evidence', () => {
    const srcDir = new URL('../src/', import.meta.url).pathname;
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    const read = (f: string) => fs.readFileSync(srcDir + f, 'utf8');
    const src = files.map(read).join('\n');

    // CONTROL vocabulary: things the hub demonstrably HAS. If the scanner
    // cannot find these, its zero below would be worthless.
    const CONTROL = ['rateLimit', 'readyState', 'broadcast', 'ping', 'close'];
    const controlMisses = CONTROL.filter((k) => !new RegExp(k).test(src));
    expect(controlMisses).toEqual([]);

    // SUBJECT vocabulary: the transport-level primitives a bounded hub needs.
    // NOTE 'coalesce' is deliberately NOT here — see the arm's own note:
    // SQL's COALESCE() is a homograph, not a backpressure mechanism.
    const SUBJECT = [
      'bufferedAmount', 'backpressure', 'back_?pressure', '\\bdrain\\b',
      'highWaterMark', 'slowConsumer', 'maxBuffer', 'queueLimit',
      'maxPending', 'terminate',
    ];
    const subjectHits = SUBJECT.filter((k) => new RegExp(k, 'i').test(src));
    expect(subjectHits).toEqual([]);

    // The scanner's precision limit, recorded rather than hidden: the only
    // 'coalesce' occurrences in hub/src are the SQL function COALESCE(...).
    // A homograph must not be counted as the mechanism (R460-3/R460-4:
    // a noun-position hit is not a claim).
    const coalesceHits = (src.match(/coalesce/gi) ?? []).length;
    const sqlCoalesce = (src.match(/COALESCE\s*\(/g) ?? []).length;
    expect(coalesceHits).toBe(sqlCoalesce);
  }, TEST_TIMEOUT);

  // ------------------------------------------------------------------ B

  it('B a peer that stops reading grows the hub\'s outbound backlog on that socket without bound, and the inventory reports nothing about it', async () => {
    const { server, pub } = await setupHubWithSlowPeer('b');
    const agentWs = hubSocket(server, 'slowpoke');
    expect(agentWs.bufferedAmount).toBe(0);

    // Drive the hub's REAL outbound path: the publisher's message is
    // fanned out by the hub to the slow peer through the hub's own
    // `send()`. (Bypassing `send()` here would make a repair to `send()`
    // invisible — my own bug, caught by the M1 mutant in v1.)
    publishBurst(pub, BURST);
    await waitForFanoutComplete(pub, BURST);
    await waitFor(() => agentWs.bufferedAmount > 0, 8000, 'backlog to appear');
    const afterFirst = agentWs.bufferedAmount;
    expect(afterFirst).toBeGreaterThan(0);

    // F1 IT IS UNBOUNDED — it scales with what the hub writes, with no
    // ceiling anywhere in the path. A second burst adds more.
    publishBurst(pub, BURST);
    await waitForFanoutComplete(pub, BURST * 2);
    await waitFor(() => agentWs.bufferedAmount > afterFirst, 8000, 'backlog to grow further');
    expect(agentWs.bufferedAmount).toBeGreaterThan(afterFirst);

    // F2 NOTHING REPORTS IT. The hub's operator-facing inventory carries no
    // backlog field at all — the shape is fixed at four keys.
    const info = server.getAgentsInfo();
    expect(info.length).toBeGreaterThan(0);
    for (const a of info) {
      expect(Object.keys(a).sort()).toEqual(['agentId', 'connectedAt', 'lastSeen', 'topics']);
    }
  }, TEST_TIMEOUT);

  // ------------------------------------------------------------------ C

  it('C CONTROL: a peer that DOES read receives every message — so B is not "messages are always lost"', async () => {
    const dir = mkTempDir('c');
    const port = await freePort();
    const d = (db = new ClawDB(dir));
    const server = new WSServer(baseConfig(dir, port), d);
    servers.push(server);

    const fast = drainingClient(port, 'fastreader');
    clients.push(fast.client);
    await fast.opened;
    fast.client.send(JSON.stringify({ type: 'join', topic: 't' }));
    await waitFor(
      () => fast.frames.some((f: any) => f && f.type === 'history'),
      5000, 'join to be acknowledged',
    );

    const N = 25;
    for (let i = 0; i < N; i++) {
      fast.client.send(JSON.stringify({ type: 'message', topic: 't', content: `m-${i}` }));
    }

    await waitFor(() => {
      const msgs = fast.frames.filter((f: any) => f && f.type === 'message');
      return msgs.length >= N;
    }, 8000, `${N} messages to arrive`);

    // The publisher is ALSO a member of 't', so it receives each message
    // TWICE: once through the topic fanout, and once as the sender's own
    // acknowledgement (`{...message, sent:true}`, ws_server.ts:446-448).
    // Both carry type 'message'. Count DISTINCT contents, not frames.
    const msgs = fast.frames.filter((f: any) => f && f.type === 'message') as any[];
    const contents = new Set(msgs.map((m) => m.content));
    expect(contents.size).toBe(N);
    // The two copies are distinguishable: one is flagged `sent`.
    const acked = msgs.filter((m) => m.sent === true);
    expect(acked.length).toBe(N);
  }, TEST_TIMEOUT);

  // ------------------------------------------------------------------ D

  it('D the hub\'s liveness ping is queued BEHIND the backlog it exists to probe', async () => {
    const { server, slow, pub } = await setupHubWithSlowPeer('d');
    const agentWs = hubSocket(server, 'slowpoke');

    // ---- the CONTROL ping: written to THIS socket with an EMPTY backlog.
    //
    // Same socket, same protocol, same server — the only thing that
    // differs from the finding ping below is whether a backlog existed
    // when the ping was written. That makes the comparison a controlled
    // A/B on ONE subject rather than two different subjects.
    //
    // It is TAGGED ('CTRL') so the two pings are distinguishable by
    // identity and not merely by position. `ws.ping(data)` supports this.
    agentWs.ping(Buffer.from('CTRL'));
    // No wait here: the socket is paused, so this frame cannot arrive yet.
    // Waiting for it would deadlock the arm (my own bug, first version).

    // ---- build the backlog, through the hub's real fanout path ----
    publishBurst(pub, BURST);
    await waitForFanoutComplete(pub, BURST);
    await waitFor(() => agentWs.bufferedAmount > 0, 8000, 'backlog to appear');

    // F3 THE BACKLOG IS WHERE THE MECHANISM LIVES. The queued bytes sit in
    // the KERNEL socket write buffer (`_socket._writableState.length`),
    // not in `ws`'s own sender queue — so `bufferedAmount` is the only
    // signal that sees them, and the hub never reads it.
    //
    // Measured HERE, while the backlog still exists (measuring it after
    // the drain reads zero — my own bug, first version).
    const internals = agentWs as unknown as {
      _socket: { _writableState: { length: number } };
      _sender: { _bufferedBytes: number };
    };
    expect(internals._socket._writableState.length).toBeGreaterThan(0);
    expect(agentWs.bufferedAmount).toBeGreaterThan(0);

    // ---- the FINDING ping: the hub's OWN liveness probe, written to the
    //      SAME socket, now behind a multi-megabyte backlog ----
    (server as unknown as { pingAll: () => void }).pingAll();

    // Resume the peer so the queued frames drain. A socket reads in wire
    // order, and the wire order is the order in which the hub wrote the
    // frames onto this socket.
    (slow.client as unknown as { _socket: net.Socket })._socket.resume();
    await waitFor(
      () => slow.order.filter((o) => o.startsWith('PING:')).length >= 2,
      30000, 'both pings to arrive',
    );
    await new Promise((r) => setTimeout(r, 500));

    // F1 THE CONTROL PING IS FIRST — index 0. It was written with an empty
    // backlog, so it went out immediately, ahead of everything else.
    const pingIndices = slow.order
      .map((o, i) => (o.startsWith('PING:') ? i : -1))
      .filter((i) => i >= 0);
    expect(pingIndices.length).toBe(2);
    expect(pingIndices[0]).toBe(0);
    expect(slow.order[0]).toBe('PING:CTRL');

    // F2 THE FINDING PING IS LAST — after EVERY queued data frame. The
    // hub's liveness probe is delivered by the very backlog it was meant
    // to detect. So a congested peer cannot be diagnosed by the probe
    // that exists to diagnose it.
    const dataCount = slow.order.filter((o) => o === 'data').length;
    expect(dataCount).toBe(BURST);

    const lastDataIndex = slow.order.lastIndexOf('data');
    expect(lastDataIndex).toBeGreaterThan(pingIndices[0]);
    expect(pingIndices[1]).toBeGreaterThan(lastDataIndex);
    // The second ping is the hub's own — untagged, because `pingAll()`
    // calls `ws.ping()` with no payload.
    expect(slow.order[pingIndices[1]]).toBe('PING:UNTAGGED');

    // F4 NO PONG-BASED LIVENESS EXISTS. The hub never registers a 'pong'
    // listener, so there is no second liveness signal to fall back on.
    const src = fs.readFileSync(new URL('../src/ws_server.ts', import.meta.url).pathname, 'utf8');
    expect(/\.on\(\s*['"]pong['"]/.test(src)).toBe(false);
  }, TEST_TIMEOUT);

  // ------------------------------------------------------------------ E

  it('E the hub reports the congested peer as live — the backlog is INVISIBLE to the operator', async () => {
    const { server, pub } = await setupHubWithSlowPeer('e');
    const agentWs = hubSocket(server, 'slowpoke');

    publishBurst(pub, BURST);
    await waitForFanoutComplete(pub, BURST);
    await waitFor(() => agentWs.bufferedAmount > 0, 8000, 'backlog to appear');

    // The hub's operator-facing inventory: the peer is present, with a
    // `lastSeen` that is NOW (not an observation), and no backlog field.
    const info = server.getAgentsInfo();
    const slowInfo = info.find((a) => a.agentId === 'slowpoke');
    expect(slowInfo).toBeDefined();
    expect(slowInfo!.lastSeen).toBeGreaterThan(0);
    expect(Object.keys(slowInfo!).sort()).toEqual(['agentId', 'connectedAt', 'lastSeen', 'topics']);

    // And `lastSeen` is literally Date.now() at call time — it is the clock
    // reading of the CALLER, not an observation of the peer. A congested
    // peer and a healthy peer are indistinguishable in this field.
    const before = Date.now();
    const info2 = server.getAgentsInfo();
    const after = Date.now();
    const seen = info2.find((a) => a.agentId === 'slowpoke')!.lastSeen;
    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBeLessThanOrEqual(after);
  }, TEST_TIMEOUT);

  // ------------------------------------------------------------------ F

  it('F the plane is not expressible: no config knob, no metric, no schema column for a per-connection backlog', () => {
    const srcDir = new URL('../src/', import.meta.url).pathname;
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    const read = (f: string) => fs.readFileSync(srcDir + f, 'utf8');
    const src = files.map(read).join('\n');

    // (a) No configuration surface. `Config` has no outbound/backlog knob.
    const typesSrc = read('types.ts');
    const configBlock = typesSrc.slice(typesSrc.indexOf('export interface Config'));
    const configIface = configBlock.slice(0, configBlock.indexOf('\n}'));
    for (const knob of ['buffer', 'backpressure', 'backlog', 'queue', 'slow', 'maxBuffer']) {
      expect(configIface.toLowerCase()).not.toMatch(new RegExp(knob, 'i'));
    }

    // (b) No metric / event surface anywhere in the hub's source.
    expect(src).not.toMatch(/backlog/i);
    expect(src).not.toMatch(/bufferedAmount/i);

    // (c) CONTROL: the config interface DOES have knobs of other kinds, so
    // a zero above is evidence rather than an empty-file artefact.
    expect(configIface).toMatch(/tlsKey/);
    expect(configIface).toMatch(/federationPeers/);
    expect(configIface).toMatch(/tokenGracePeriodMs/);
  }, TEST_TIMEOUT);

  // ------------------------------------------------------------------ G

  it('G the hub\'s eviction frame is queued behind the very traffic it was issued to abort', async () => {
    const { server, slow, pub } = await setupHubWithSlowPeer('g');
    const agentWs = hubSocket(server, 'slowpoke');

    publishBurst(pub, BURST);
    await waitForFanoutComplete(pub, BURST);
    await waitFor(() => agentWs.bufferedAmount > 0, 8000, 'backlog to appear');

    // The hub evicts the congested peer.
    agentWs.close(1013, 'too slow');

    // F1 THE PEER IS STILL OPEN right after the eviction call: the close
    // frame has not reached it, because it is behind the backlog.
    expect(slow.client.readyState).toBe(1); // 1 = OPEN

    // Resume so the queued frames drain and the close frame arrives.
    (slow.client as unknown as { _socket: net.Socket })._socket.resume();
    await waitFor(() => slow.order.some((o) => o.startsWith('CLOSE(')), 30000, 'the close frame to arrive');
    await new Promise((r) => setTimeout(r, 500));

    // F2 THE CLOSE FRAME IS LAST — after every queued data frame. The
    // control signal that was supposed to stop the traffic was itself
    // delivered by that traffic.
    const closeIndex = slow.order.findIndex((o) => o.startsWith('CLOSE('));
    const dataCount = slow.order.filter((o) => o === 'data').length;
    expect(dataCount).toBe(BURST);
    expect(closeIndex).toBe(dataCount);
    expect(slow.order[closeIndex]).toBe('CLOSE(1013)');
  }, TEST_TIMEOUT);
});
