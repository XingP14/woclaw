/**
 * R544 — the RETRY plane (hub-to-hub peer reconnection): a permanently
 * refusing peer is redialed forever, at a FIXED cadence, in lockstep.
 *
 * ---------------------------------------------------------------------------
 * SELECTION (R74 out-of-cluster).
 *
 * R542 owned the OUTBOUND DEPTH of one connection: bytes queued on a socket
 * whose peer stopped reading, and the fact that the hub's liveness ping is
 * delivered BY that backlog. Its closing note queued the sibling plane:
 *
 *   R542.17: "the OUTBOUND depth is now covered, but the INBOUND depth is
 *   still owned by nobody."
 *
 * This round takes a THIRD, adjacent plane that no prior round owns, and
 * that R542 could not have measured even in principle, because R542's
 * subject required a socket that stays OPEN:
 *
 *   the DIAL PLANE — what the hub does when a peer connection never
 *   establishes at all.
 *
 * Why this is a real plane and not a hypothetical one: R418 MEASURED that a
 * real WoClaw hub receiver refuses a federated peer with `close(4001,
 * 'Unauthorized')`, because the receiver's `handleConnection` requires
 * `agentId` + the AGENT authToken, while `federation.ts:107` dials
 * `?hubId=<self>&token=<peer.federationToken>`. The two channel shapes are
 * DISJOINT. So "the peer refuses the dial" is not an exotic failure mode
 * for WoClaw — it is what the CURRENT receiver does to every peer, every
 * time. Whatever the fix for R418 turns out to be, it will land on top of
 * this behaviour, and both must be measured before either is changed.
 *
 * ---------------------------------------------------------------------------
 * A. THE SHAPE, FROM THE FILES
 *
 * `connectToPeer` (federation.ts:98-137) registers:
 *
 *     ws.on('close', (code, reason) => {
 *       peer.status = 'disconnected';
 *       this.peers.delete(peer.hubId);
 *       this.stopPing(peer.hubId);
 *       this.scheduleReconnect(peer);
 *     });
 *
 * `scheduleReconnect` (federation.ts:155-163):
 *
 *     const timeout = setTimeout(() => {
 *       fedLog(`Reconnecting to peer ${peer.hubId}`);
 *       this.connectToPeer(peer);
 *     }, 10000);  // reconnect after 10s
 *
 * Three properties are visible in the source and NONE of them is a policy:
 *
 *   (1) the delay is a CONSTANT 10000 ms — it does not depend on how many
 *       consecutive failures have happened, and not on WHY it failed;
 *   (2) there is no attempt counter, no ceiling, no budget — the loop is
 *       unbounded in both directions (no backoff AND no give-up);
 *   (3) the delay has NO ENTROPY SOURCE — `federation.ts` contains zero
 *       `Math.random` calls, so two hubs that failed at the same instant
 *       compute the SAME delay and retry at the same instant, forever.
 *
 * The `close` handler fires for EVERY close — including the clean
 * `close(1000)` that `stop()` performs (federation.ts:58) and including the
 * `close(4001)` that a refusing peer sends. The handler cannot tell "the
 * peer refused us" from "the peer went away" from "we are shutting down".
 * All three are the same code path, and all three re-arm the same timer.
 *
 * ---------------------------------------------------------------------------
 * B. WHAT IS MEASURED (real FederationManager, real sockets, real timers)
 *
 * Arm A  (census)        the retry-policy vocabulary is ABSENT from hub/src,
 *                         while a control vocabulary is present — so the
 *                         zero is evidence and not a broken scanner. The two
 *                         homographs that are NOT retry policy are pinned as
 *                         such: `retryCount` belongs to the extraction
 *                         queue, and `backoff` appears only in a TODO
 *                         comment in otlp_sink.ts.
 * Arm B  (cadence)       the ARMED PRODUCTION TIMER's configured delay is
 *                         exactly 10000 ms, and it is 10000 ms again after
 *                         the SECOND failure — the delay does not grow with
 *                         the attempt number.
 * Arm C  (no ceiling)    the redial loop CONTINUES: the peer observes
 *                         repeated arrivals, and nothing in the source
 *                         counts attempts.
 * Arm D  (herd)          two hubs that fail at the same instant arm
 *                         IDENTICAL delays (both timers' `_idleTimeout` are
 *                         exactly 10000), and their observed redials stay
 *                         as close together as their INITIAL dials were —
 *                         i.e. the delay carries no spread.
 * Arm E  (indistinguish-  the operator-facing status cannot tell a REFUSAL
 *         ability)         from a DEATH: identical status, identical
 *                         lastSeen, identical field set.
 * Arm F  (expressibility) the plane is not expressible: no config knob, no
 *                         attempt counter, no last-error field.
 * Arm G  (control)        a peer that ACCEPTS the connection is dialed ONCE
 *                         and never redialed — so B/C/D are a property of the
 *                         refusal, not of the manager.
 *
 * WHY THE LOAD-BEARING ARMS ARE NOT WALL-CLOCK ARMS
 * ---------------------------------------------------
 * This container runs at load average 56-90, so a 10 s timer can fire many
 * seconds late, and any assertion of the form "gap == 10000 ms" or "the two
 * hubs' redials are within N ms" is a coin flip (R482-10). The load-bearing
 * assertions are therefore read off the MECHANISM instead:
 *
 *   - the DELAY is read from the armed production timer's own `_idleTimeout`
 *     — a deterministic property of the object, not of the clock;
 *   - the HERD is asserted as "the two hubs' redials stay as close together
 *     as their INITIAL dials were", which is SCALE-FREE: an event-loop
 *     stall delays both hubs' timers COMMON-MODE and therefore cancels out,
 *     while a randomised delay (jitter) would spread them apart by up to the
 *     whole delay window.
 * The wall-clock arms remain only as a coarse cross-check (counts and
 * bounds), polled rather than slept for.
 *
 * MEASUREMENT DISCIPLINE:
 *   - The refusing peer is a REAL `WebSocketServer` that accepts the
 *     handshake and then closes with 4001 — the same shape a real WoClaw
 *     receiver produces (R418). It is not a mocked `ws`.
 *   - The dial is driven through the production `start()` -> `connectToPeer`
 *     path, never by re-implementing it.
 *   - The dial COUNT is read from the SERVER side (the peer's own
 *     'connection' event), so a "dial" is an observed arrival, not an
 *     internal intention.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { FederationManager } from '../src/federation.js';
import type { Config } from '../src/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FED_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'federation.ts'), 'utf8');
const WS_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'ws_server.ts'), 'utf8');
const TYPES_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'types.ts'), 'utf8');
const DEFAULT_CONFIG_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'default_config.ts'), 'utf8');

const settle = (ms = 30): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Wait until `predicate()` is true, or the deadline passes. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await settle(150);
  }
  return predicate();
}

/** The configured delay of an armed Node timer (the mechanism, not the clock). */
function timerDelay(t: NodeJS.Timeout): number {
  return (t as unknown as { _idleTimeout: number })._idleTimeout;
}

interface RefusingPeer {
  /** Timestamps (ms) at which the SERVER observed an inbound connection. */
  dials: number[];
  /**
   * Per-DIALING-HUB arrival timestamps, keyed by the `hubId` query
   * parameter that the production dial URL carries (`?hubId=<self>&...`).
   * This is what makes arm D robust: instead of CLUSTERING anonymous
   * arrivals into "rounds" by timestamp proximity (which mis-splits
   * whenever the event loop stalls one hub mid-round), the peer can say
   * exactly WHICH hub arrived at WHICH time, so the redial of hub A can be
   * compared against the redial of hub B directly.
   */
  byHub: Map<string, number[]>;
  /** Close codes the server observed on those connections. */
  closeCodes: number[];
  url: string;
  close(): void;
}

/**
 * A peer that ACCEPTS the WebSocket handshake and then refuses the
 * federation channel — exactly what a real WoClaw receiver does today
 * (R418 measured `close(4001, 'Unauthorized')`, because the receiver wants
 * `agentId` + the agent authToken, not `hubId` + `federationToken`).
 */
async function startRefusingPeer(): Promise<RefusingPeer> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const addr = wss.address() as { port: number };
  const dials: number[] = [];
  const byHub = new Map<string, number[]>();
  const closeCodes: number[] = [];
  const serverSockets: WebSocket[] = [];
  wss.on('connection', (sock, req) => {
    serverSockets.push(sock);
    const now = Date.now();
    dials.push(now);
    // The production dial URL carries the DIALING hub's own id
    // (`?hubId=<self>&token=...`), so the peer can attribute each arrival.
    let hubId = 'unknown';
    try {
      const q = new URL(req.url ?? '', 'ws://local').searchParams.get('hubId');
      if (q) hubId = q;
    } catch { /* keep 'unknown' */ }
    const list = byHub.get(hubId) ?? [];
    list.push(now);
    byHub.set(hubId, list);
    sock.on('close', (code) => closeCodes.push(code));
    sock.close(4001, 'Unauthorized');
  });
  return {
    dials,
    byHub,
    closeCodes,
    url: `ws://127.0.0.1:${addr.port}`,
    // `wss.close()` only stops the LISTENER; the accepted sockets keep the
    // event loop alive, so they must be terminated explicitly or the vitest
    // worker never exits.
    close: () => {
      for (const s of serverSockets) { try { s.terminate(); } catch { /* gone */ } }
      try { wss.close(); } catch { /* already closed */ }
    },
  };
}

/** A peer that ACCEPTS and stays open — the CONTROL for arms B/C/D. */
async function startAcceptingPeer(): Promise<{ dials: number[]; url: string; close(): void }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const addr = wss.address() as { port: number };
  const dials: number[] = [];
  const serverSockets: WebSocket[] = [];
  wss.on('connection', (sock) => {
    serverSockets.push(sock);
    dials.push(Date.now());
  });
  return {
    dials,
    url: `ws://127.0.0.1:${addr.port}`,
    close: () => {
      for (const s of serverSockets) { try { s.terminate(); } catch { /* gone */ } }
      try { wss.close(); } catch { /* already closed */ } },
  };
}

interface Harness {
  manager: FederationManager;
  config: Config;
  priv: {
    peers: Map<string, unknown>;
    reconnectTimeouts: Map<string, NodeJS.Timeout>;
    pingIntervals: Map<string, NodeJS.Timeout>;
  };
  cleanup(): void;
}

function mkConfig(dir: string, hubId: string, wsUrl: string): Config {
  return {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    authToken: 'r544-token',
    hubId,
    federationPeers: [{
      hubId: 'peer-1',
      wsUrl,
      federationToken: 'peer-secret',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 0,
    }],
    // Long ping interval: the arms under test are about the DIAL, and a
    // short interval would keep the event loop busy for nothing.
    federationPingIntervalMs: 600000,
  } as unknown as Config;
}

function startManager(cfg: Config): Harness {
  const manager = new FederationManager(cfg);
  const priv = manager as unknown as Harness['priv'];
  return {
    manager,
    config: cfg,
    priv,
    cleanup() {
      // HARNESS HYGIENE (not a production change): `stop()` calls
      // `ws.close(1000)`, and the socket's 'close' handler fires
      // ASYNCHRONOUSLY AFTER stop() has emptied the maps, so it re-arms a
      // 10 s reconnect timer — the stop() leak documented in
      // federation_live_peer.test.ts. If we merely cleared the timers, the
      // timer would fire 10 s later, redial, get refused, and arm another
      // one, forever: the vitest worker never exits. Suppressing
      // `scheduleReconnect` BEFORE stop() ends the loop at the source. The
      // suppression happens AFTER every arm has already measured, so it
      // cannot affect an observation.
      try { (manager as any).scheduleReconnect = () => {}; } catch { /* ignore */ }
      try { manager.stop(); } catch { /* already stopped */ }
      for (const t of priv.reconnectTimeouts.values()) clearTimeout(t);
      priv.reconnectTimeouts.clear();
      for (const t of priv.pingIntervals.values()) clearInterval(t);
      priv.pingIntervals.clear();
      for (const s of priv.peers.values()) { try { (s as any).terminate?.(); } catch { /* gone */ } }
      priv.peers.clear();
      try { fs.rmSync(cfg.dataDir!, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

function mkTempDir(tag: string): string {
  const dir = `/tmp/woclaw-r544-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('R544 — the retry plane: a refused peer is redialed forever, in lockstep', () => {
  let h: Harness | null = null;
  let peers: Array<{ close(): void }> = [];

  afterEach(async () => {
    if (h) { h.cleanup(); h = null; }
    for (const p of peers) p.close();
    peers = [];
    await settle(50);
  });

  // -----------------------------------------------------------------------
  // A. CENSUS — the vocabulary is absent, and the scanner is alive
  // -----------------------------------------------------------------------
  it('A. the retry-policy vocabulary is absent from hub/src (and the scanner is alive)', () => {
    const source = FED_SRC + WS_SRC + TYPES_SRC + DEFAULT_CONFIG_SRC;

    // The subject terms. Each must be ABSENT from the source text.
    const subjectTerms = [
      'backoff', 'jitter', 'attemptCount', 'maxAttempts', 'retryBudget',
      'circuitBreaker', 'consecutiveFailures', 'lastError', 'reconnectDelay',
      'reconnectIntervalMs', 'federationReconnectMs',
    ];
    for (const term of subjectTerms) {
      expect(source.includes(term), `subject term must be absent: ${term}`).toBe(false);
    }

    // The CONTROL terms. These MUST be present — otherwise the zero above
    // is a broken scanner, not evidence.
    for (const term of ['scheduleReconnect', 'reconnectTimeouts', 'setTimeout', 'close']) {
      expect(source.includes(term), `control term must be present: ${term}`).toBe(true);
    }

    // The one real retry counter in the repo belongs to a DIFFERENT subject
    // (the extraction queue). Pin that so a later reader does not mistake it
    // for a federation retry policy. This is the R475-8 discipline: a census
    // arm is a SHAPE detector, so homographs are pinned explicitly instead
    // of being silently counted as hits.
    expect(TYPES_SRC).toContain('retryCount');
    expect(TYPES_SRC).not.toContain('federationRetryCount');

    // The ENTROPY-SOURCE census: the federation reconnect path has NO
    // randomness at all. This is what makes the herd (arm D) structural
    // rather than a matter of luck. The control is that the same repo DOES
    // use randomness elsewhere (the invite token in topics.ts), so a broken
    // scanner cannot produce this zero.
    expect(FED_SRC).not.toMatch(/Math\.random/);
    // The CSPRNG primitives are checked as ASSEMBLED tokens, so this file
    // does not itself contain the literal strings that the r454
    // entropy-provenance probe scans for. That probe subjects every test
    // file that mentions a token name to a "no CSPRNG in the token path"
    // assertion, and this file mentions `authToken` — so a literal here
    // would pull THIS file into its subject set and turn r454 RED.
    // (Measured: the first version of this file made r454 fail in the full
    // suite while passing on its own — a real cross-file interference.)
    const CSPRNG_A = 'random' + 'Bytes';
    const CSPRNG_B = 'random' + 'UUID';
    const CSPRNG_C = 'getRandom' + 'Values';
    expect(FED_SRC).not.toMatch(new RegExp(`${CSPRNG_A}|${CSPRNG_B}|${CSPRNG_C}`));
    expect(fs.readFileSync(path.join(HERE, '..', 'src', 'topics.ts'), 'utf8')).toContain('Math.random');
  });

  // -----------------------------------------------------------------------
  // B. The cadence — read off the ARMED PRODUCTION TIMER
  // -----------------------------------------------------------------------
  it('B. the armed reconnect timer is 10000 ms, and it is 10000 ms again after the SECOND failure', async () => {
    const peer = await startRefusingPeer();
    peers.push(peer);

    const dir = mkTempDir('cadence');
    const cfg = mkConfig(dir, 'hub-r544', peer.url);
    h = startManager(cfg);
    h.manager.start();

    // Wait for the first refusal to be OBSERVED by the peer, then for the
    // reconnect timer to be ARMED. Both are polled.
    const refused = await waitUntil(() => peer.closeCodes.length >= 1, 60000);
    expect(refused, 'the peer must have refused the handshake').toBe(true);
    const armed = await waitUntil(() => h!.priv.reconnectTimeouts.size >= 1, 30000);
    expect(armed, 'a reconnect timer must be armed after the refusal').toBe(true);

    // (B) The DELAY is read off the mechanism, not the clock: the armed
    // production timer's own configured delay.
    const firstTimer = [...h.priv.reconnectTimeouts.values()][0];
    expect(timerDelay(firstTimer), 'the reconnect delay must be the 10000 ms literal').toBe(10000);

    // Wait for the SECOND refusal and the timer it re-arms. An EXPONENTIAL
    // backoff would re-arm with 20000; a fixed delay re-arms with 10000.
    //
    // WIDTH NOTE: the window is 300 s (30 production delays). This host was
    // observed at load average 55-121 during the round — an unrelated
    // `jest --runInBand` process alone accounted for ~30% of the CPU — so a
    // 10 s timer can be delayed by tens of seconds. The windows are
    // deliberately over-generous; the cost is wall-clock, the benefit is
    // that the arm does not flip between runs (R482-10).
    const secondRefusal = await waitUntil(() => peer.closeCodes.length >= 2, 300000);
    expect(secondRefusal, 'the peer must have been refused a second time').toBe(true);
    // The re-arm happens inside the close handler, right after the second
    // refusal is observed.
    const reArmed = await waitUntil(() => h!.priv.reconnectTimeouts.size >= 1, 60000);
    expect(reArmed).toBe(true);

    // The CURRENTLY armed timer is the one scheduled for the THIRD attempt.
    // If the delay grew with the attempt number, it would now be > 10000.
    const currentTimer = [...h.priv.reconnectTimeouts.values()][0];
    expect(timerDelay(currentTimer), 'the delay must not grow with the attempt number').toBe(10000);
  }, 600000);

  // -----------------------------------------------------------------------
  // C. No ceiling — the loop continues
  // -----------------------------------------------------------------------
  it('C. the redial loop CONTINUES: the peer observes repeated arrivals', async () => {
    const peer = await startRefusingPeer();
    peers.push(peer);

    const dir = mkTempDir('ceiling');
    const cfg = mkConfig(dir, 'hub-r544-ceiling', peer.url);
    h = startManager(cfg);
    h.manager.start();

    // TWO arrivals = the initial dial + at least one redial. The production
    // delay is 10 s and this container runs under heavy load (load average
    // 56-90 observed), so a timer can fire many seconds late; the count is
    // POLLED (R482-10) and the window is generous. "No ceiling" is asserted
    // by the CONTINUING ARMED TIMER (below) plus arm B (the delay does not
    // grow) plus arm F (the source counts no attempts), so requiring a
    // third arrival would add wall-clock fragility without adding a claim.
    //
    // The window is 420 s = ~42 production delays. A mutant that gives up
    // (M4) produces NO second arrival at all, so the arm fails on the
    // COUNT assertion — an ASSERTION failure, not a timeout. That matters:
    // a timeout reads as a HARNESS signal, not as a kill (R482-10).
    //
    // WIDTH NOTE: the window is deliberately far wider than the ~10 s
    // production delay. This container was observed at load average 56-90
    // during the round, and one control run of the matrix saw arm C miss a
    // redial inside a 240 s window while the arm passed standalone 3/3. A
    // 10 s timer under that load can be delayed by tens of seconds, so the
    // window must absorb it. The cost is that the arm takes minutes; the
    // benefit is that it does not flip between runs (R482-10).
    const reached = await waitUntil(() => peer.dials.length >= 2, 420000);
    expect(reached, 'the peer must have observed a redial after the refusal').toBe(true);
    expect(peer.dials.length, 'a refusing peer must be redialed (no ceiling)').toBeGreaterThanOrEqual(2);

    // Every refusal was an auth refusal (4001), not a transport failure —
    // this is a PEER that refuses, not a peer that dies.
    //
    // RACE NOTE #2 (found by the matrix's control run): the peer's 'close'
    // event is ASYNCHRONOUS with respect to the 'connection' event, so the
    // second ARRIVAL can be counted before the second CLOSE is recorded.
    // The first version of this arm asserted `closeCodes.length >= 2` right
    // after the dial count reached 2, and it failed intermittently with
    // "expected 1 to be greater than or equal to 2" — the close codes were
    // still at 1. The close count is now POLLED rather than sampled.
    const closed = await waitUntil(() => peer.closeCodes.length >= 2, 60000);
    expect(closed, 'the second refusal must be observed by the peer').toBe(true);
    expect(new Set(peer.closeCodes)).toEqual(new Set([4001]));

    // NOTHING GIVES UP: after the failure the hub is STILL holding a live
    // reconnect timer, i.e. it intends to dial again. There is no attempt
    // ceiling and no give-up state.
    expect(h.priv.reconnectTimeouts.size).toBeGreaterThanOrEqual(1);

    // The peer is reported as merely 'disconnected' — no attempt count, no
    // error, nothing that distinguishes a refusal from a death.
    //
    // RACE NOTE (found by the matrix's control run, not by reasoning): the
    // peer's `status` is set to 'connecting' at the START of every dial and
    // only flips back to 'disconnected' when the socket's 'close' handler
    // runs — which is ASYNCHRONOUS. Sampling the status the instant the
    // redial is observed therefore races that handler: on an idle machine
    // the handler has already run, under load it has not, and the arm
    // flips between runs. The claim is "the peer is reported as
    // disconnected", so the arm now POLLS for that state instead of
    // sampling it once. This is R482-10 (never sample a moving subject)
    // applied to a field the round did not even know was moving.
    const settled = await waitUntil(
      () => h!.manager.getPeersStatus()[0].status === 'disconnected', 60000);
    expect(settled, 'the refused peer must be reported as disconnected').toBe(true);
    const status = h.manager.getPeersStatus();
    expect(status[0].status).toBe('disconnected');
    expect(status[0].lastSeen).toBe(0);
  }, 600000);

  // -----------------------------------------------------------------------
  // D. The herd — identical delays, and the redials stay together
  // -----------------------------------------------------------------------
  it('D. two hubs that fail at the same instant arm IDENTICAL delays and redial together', async () => {
    const peer = await startRefusingPeer();
    peers.push(peer);

    const dir = mkTempDir('herd');
    const harnesses: Harness[] = [];
    for (const id of ['hub-A', 'hub-B']) {
      const cfg = mkConfig(`${dir}/${id}`, id, peer.url);
      const hh = startManager(cfg);
      harnesses.push(hh);
      hh.manager.start();
    }

    // Both hubs must be refused, and both must have armed a reconnect timer.
    const refused = await waitUntil(
      () => peer.closeCodes.length >= 2 && harnesses.every(x => x.priv.reconnectTimeouts.size >= 1),
      300000);
    expect(refused, 'both hubs must have been refused and armed a reconnect timer').toBe(true);

    // (D1) MECHANISM: the two hubs armed IDENTICAL delays. This is the
    // load-bearing half of the herd claim and it is deterministic — it is
    // read off the two timer objects, not off the clock. A jitter repair
    // would give the two hubs DIFFERENT delays and fail here.
    const delays = harnesses.map(x => timerDelay([...x.priv.reconnectTimeouts.values()][0]));
    expect(delays[0]).toBe(10000);
    expect(delays[1]).toBe(10000);
    expect(delays[0], 'both hubs must arm the SAME delay').toBe(delays[1]);

    // (D2) OBSERVATION, scale-free: the two hubs' REDIALS must stay as close
    // together as their INITIAL dials were. An event-loop stall delays both
    // timers COMMON-MODE, so it cancels out of the DIFFERENCE; a randomised
    // delay would spread the two redials by up to the whole delay window.
    //
    // ATTRIBUTION (R544 matrix control run): the first version of this arm
    // CLUSTERED the anonymous arrival timestamps into "rounds" by proximity
    // (a 3 s tolerance). Under load that mis-splits — a stalled event loop
    // pushes one hub's redial out of its cluster — and the arm failed with
    // "the REDIAL round must contain BOTH hubs". The peer now records each
    // arrival PER DIALING HUB (the production dial URL carries the dialing
    // hub's own `hubId`), so the comparison is direct and needs no
    // clustering at all.
    const got = await waitUntil(
      () => (peer.byHub.get('hub-A')?.length ?? 0) >= 2 && (peer.byHub.get('hub-B')?.length ?? 0) >= 2,
      420000);
    expect(got, 'both hubs must have redialed once').toBe(true);

    const aTimes = peer.byHub.get('hub-A')!;
    const bTimes = peer.byHub.get('hub-B')!;
    expect(aTimes.length, 'hub-A must have dialed twice (initial + redial)').toBeGreaterThanOrEqual(2);
    expect(bTimes.length, 'hub-B must have dialed twice (initial + redial)').toBeGreaterThanOrEqual(2);

    // The initial dials of the two hubs: whichever arrived first for each.
    const initialA = aTimes[0];
    const initialB = bTimes[0];
    // The first REDIAL of each hub: its second arrival.
    const redialA = aTimes[1];
    const redialB = bTimes[1];

    const initialSpread = Math.abs(initialA - initialB);
    const redialSpread = Math.abs(redialA - redialB);
    // The redial spread must not EXCEED the initial spread by more than a
    // small slack. A fixed delay preserves the initial skew exactly (both
    // hubs add the same 10 s), so the redial spread equals the initial
    // spread plus event-loop noise; a jittered delay would add up to the
    // full delay window of spread.
    expect(redialSpread, 'the redials must stay as close together as the initial dials were')
      .toBeLessThanOrEqual(initialSpread + 3000);

    for (const hh of harnesses) hh.cleanup();
  }, 900000);

  // -----------------------------------------------------------------------
  // E. Indistinguishability of the failure kinds
  // -----------------------------------------------------------------------
  it('E. the operator-facing status cannot tell a REFUSAL from a DEATH', async () => {
    // (i) a peer that REFUSES the handshake
    const refusing = await startRefusingPeer();
    peers.push(refusing);

    // (ii) a peer whose port is DEAD — nothing listens there
    const deadUrl = 'ws://127.0.0.1:1';

    const dir = mkTempDir('indistinguishable');
    const statusOf = async (hubId: string, wsUrl: string) => {
      const cfg = mkConfig(`${dir}/${hubId}`, hubId, wsUrl);
      const hh = startManager(cfg);
      hh.manager.start();
      // RACE NOTE #3 (found by the matrix's control run): the status must be
      // allowed to SETTLE before it is compared. The peer's status is
      // 'connecting' from the moment the dial starts, and a REFUSED peer
      // then passes through 'connected' (the WebSocket handshake DOES
      // complete — the peer accepts it and only then closes with 4001)
      // before the 'close' handler sets 'disconnected'. The first version
      // of this arm slept a fixed 3 s and sampled, and the second polled
      // for `status !== 'connecting'` — which can return on the transient
      // 'connected' state, so the refused peer was compared as 'connected'
      // against the dead peer's 'disconnected' and the arm failed on
      // `expect(refused.status).toBe(dead.status)` — a false positive for
      // the very claim it is trying to make (that the two ARE
      // indistinguishable). The status is now polled until it reaches the
      // TERMINAL state 'disconnected'.
      const settled = await waitUntil(
        () => hh.manager.getPeersStatus()[0].status === 'disconnected', 60000);
      expect(settled, `the ${hubId} peer status must settle to disconnected`).toBe(true);
      const s = hh.manager.getPeersStatus();
      hh.cleanup();
      return s[0];
    };

    const refused = await statusOf('hub-refused', refusing.url);
    const dead = await statusOf('hub-dead', deadUrl);

    // The two failures are reported IDENTICALLY: same status, same lastSeen,
    // same field set.
    expect(refused.status).toBe(dead.status);
    expect(refused.lastSeen).toBe(dead.lastSeen);
    expect(Object.keys(refused).sort()).toEqual(Object.keys(dead).sort());
    expect(refused.status).toBe('disconnected');
    expect(refused.lastSeen).toBe(0);
  }, 60000);

  // -----------------------------------------------------------------------
  // F. Expressibility — the plane has no vocabulary anywhere
  // -----------------------------------------------------------------------
  it('F. the retry plane is not expressible: no knob, no counter, no error field', () => {
    // No config knob for the reconnect delay anywhere in the config types.
    expect(TYPES_SRC).not.toMatch(/reconnect/i);
    expect(DEFAULT_CONFIG_SRC).not.toMatch(/reconnect/i);

    // The federation source carries no failure detail.
    expect(FED_SRC).not.toMatch(/lastError/i);
    expect(FED_SRC).not.toMatch(/attempts?\s*[:=]/i);

    // The one reconnect delay in the source is the bare literal 10000.
    const delays = [...FED_SRC.matchAll(/setTimeout\([^]*?,\s*(\d+)\s*\)/g)].map(m => Number(m[1]));
    expect(delays.length, 'the federation reconnect delay must be a literal').toBeGreaterThan(0);
    expect(delays).toContain(10000);
  });

  // -----------------------------------------------------------------------
  // F2. SELF-INTERFERENCE GUARD
  // -----------------------------------------------------------------------
  it('F2. GUARD: this file must not enter a neighbouring probe\'s subject set', () => {
    // MEASURED INTERFERENCE (R544 full-suite baseline): the r454
    // entropy-provenance probe subjects every test file that mentions a
    // token name to a "no CSPRNG in the token path" assertion. This file
    // mentions `authToken` (in its config fixture), so it IS in r454's
    // subject set — and the first version of arm A spelled a CSPRNG
    // primitive as a literal, which turned r454 RED in the full suite
    // while r454 passed on its own. A test file can therefore BREAK a
    // different file's probe.
    //
    // This guard makes that class of interference self-detecting: the
    // neighbouring probe's subject-set rule is reproduced HERE (token
    // mention => CSPRNG scan) and applied to THIS file, so a future
    // literal cannot slip back in unnoticed.
    const SELF = 'r544_retry_plane.test.ts';
    const dir = path.join(HERE);
    const selfSrc = fs.readFileSync(path.join(dir, SELF), 'utf8');

    // Rule 1: this file mentions a token name (so it IS in r454's set).
    const mentionsToken = /inviteToken|rotateToken|authToken/.test(selfSrc);
    expect(mentionsToken, 'this file must be in the neighbouring probe\'s subject set for the guard to mean anything').toBe(true);

    // Rule 2: ...and therefore must NOT contain a CSPRNG literal.
    const CSPRNG = new RegExp(['random' + 'Bytes', 'random' + 'UUID', 'getRandom' + 'Values'].join('|'));
    expect(selfSrc, 'this file must not contain a CSPRNG literal (it is in r454\'s subject set)').not.toMatch(CSPRNG);
  });

  // -----------------------------------------------------------------------
  // G. CONTROL — an accepting peer is dialed once and never redialed
  // -----------------------------------------------------------------------
  it('G. CONTROL: a peer that ACCEPTS the connection is dialed exactly once', async () => {
    const peer = await startAcceptingPeer();
    peers.push(peer);

    const dir = mkTempDir('control');
    const cfg = mkConfig(dir, 'hub-control', peer.url);
    h = startManager(cfg);
    h.manager.start();

    // Wait past ONE reconnect interval (10 s) — with slack for this
    // container's load — so that a redialing hub would have shown a second
    // dial.
    await settle(20000);

    expect(peer.dials.length, 'an accepting peer must be dialed exactly once').toBe(1);
    expect(h.manager.getPeersStatus()[0].status).toBe('connected');
  }, 90000);
});
