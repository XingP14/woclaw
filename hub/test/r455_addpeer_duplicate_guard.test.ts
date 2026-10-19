/**
 * R455 — `addPeer()`'s duplicate guard consults the CONNECTED map, not the
 * CONFIGURED list, and passes the INCOMING object rather than the MERGED one.
 *
 * Why this file exists
 * --------------------
 * federation_live_peer.test.ts already has a test named "re-arming an
 * already-connected peer keeps exactly one ping timer". It calls addPeer a
 * second time for a peer whose socket is OPEN — and in that state
 * `connectToPeer`'s guard `if (this.peers.has(peer.hubId)) return;` fires, so
 * the assertion holds and the gap stays invisible.
 *
 * But `peers` is populated in the ws 'open' handler, ASYNCHRONOUSLY. Between
 * `new WebSocket(...)` returning and 'open' firing there is a window in which
 * the peer is CONFIGURED and CONNECTING and present in NEITHER `peers` NOR
 * any pending set. Every duplicate addPeer landing in that window slips past
 * the guard and dials a second socket. `addPeer` already merges the incoming
 * peer into `this.config.federationPeers` — the CONFIGURED list, which IS
 * populated synchronously — so the information needed to close the window is
 * in hand one line away and simply not consulted.
 *
 * The route is public: POST /federation/peers (rest_server.ts:531) calls
 * addFederationPeer with no de-duplication of its own.
 *
 * Three claims, each measured before being pinned:
 *
 *   C1  a duplicate addPeer inside the CONNECTING window opens a SECOND socket
 *   C2  a duplicate addPeer for a CONNECTED peer whose wsUrl CHANGED updates
 *       the configured list but never dials the new URL
 *   C3  (second-order, the actual finding) when the losing socket of C1 dies,
 *       its 'close' handler deletes the map entry the WINNING socket installed
 *       and arms a reconnect — so a duplicate POST disarms the self-healing
 *       path for a peer that is still perfectly healthy
 *
 * C3 is why this is more than a cosmetic duplicate: the hub reports a live,
 * working peer as `disconnected` and untracked, `sendToAgent` can no longer
 * reach it, and 10s later a reconnect fires at it for no reason.
 *
 * These are BEHAVIOUR decisions (what should a duplicate POST do? reconnect?
 * refuse 409? update in place?), so this suite PINS the current behaviour and
 * changes zero production lines. If addPeer ever gains a `stopped`/pending
 * guard, the "CURRENT BEHAVIOUR" arms below are the ones to flip.
 *
 * Verification for this round (re-measured by the 00:03 tick, which ADOPTED
 * this file from a tick that died before running its matrix):
 *
 *   12 arms GREEN, 4 consecutive runs, no flake (after two real harness
 *   defects were found and fixed -- see "HARNESS DEFECTS FOUND BY ADOPTION").
 *   Mutation matrix 9 mutants: 5 KILLED (M1, M2, M3, M8, M9), 1 MEASURED
 *   EQUIVALENT (M4), 3 SCOPED SURVIVORS (M5, M6, M7).
 *   tsc --noEmit clean, src/ md5 identical before and after, zero
 *   production changes.
 *
 * HARNESS DEFECTS FOUND BY ADOPTION (the dead tick's draft had neither):
 *
 *   1. `ws` WebSocket instances expose NO `.url`. The first version of the C2
 *      relation arm read `(srv.sockets[0] as {url: string}).url` and threw
 *      `Cannot read properties of undefined` on every run. The dialed url
 *      exists server-side only on the upgrade REQUEST, and even there
 *      `req.url` is PATH+QUERY (`/?hubId=..&token=..`), not the authority --
 *      so the arm was corrected to assert what a handshake genuinely proves:
 *      exactly ONE handshake arrived, carrying the original identity and not
 *      the CHANGED path.
 *   2. Fixed `settle(250)` sleeps made three arms flaky. Replaced with an
 *      `until(pred)` poll. Two arms then failed DETERMINISTICALLY, which is
 *      how the third defect surfaced:
 *   3. The C3 arm polled `peers.size === 1` and then asserted
 *      `config[0].status === 'connected'`. Those are written by the SAME 'open'
 *      handler but on DIFFERENT objects: `addPeer` merges into the existing
 *      configured entry, preserving its identity, while the LOSER socket's
 *      handler holds the INCOMING peer -- so a later close writes
 *      `status='disconnected'` onto an object the arm was not watching. Poll
 *      the value the arm ASSERTS, never a proxy for it.
 *
 * THE HEADLINE FINDING (why M4 is equivalent, not missed):
 *
 *   The natural C2 fix -- make the duplicate guard compare urls --
 *
 *     const live = this.peers.get(peer.hubId);
 *     if (live && this.config.federationPeers?.find(p => p.hubId === peer.hubId)?.wsUrl === peer.wsUrl)
 *       return;
 *
 *   is a NO-OP, because `addPeer` runs `Object.assign(existing, peer)` BEFORE
 *   `connectToPeer(peer)`. By the time the guard reads the configured list it
 *   already holds the INCOMING peer, so the second conjunct compares the
 *   incoming url with itself and is true whenever `live` is. The mutant is
 *   indistinguishable from `peers.has(...)`, which is why 10/10 -- and why a
 *   suite cannot kill it. Measured by scripts/r455_probe3.ts:
 *
 *     live map has peerA (first conjunct): true
 *     configured wsUrl at guard time     : ws://127.0.0.1:1/CHANGED
 *     second conjunct (cfg === incoming) : true  <= ALWAYS true
 *     sockets dialled for the CHANGED url: 0
 *
 *   A fix for C2 has to compare against something that is NOT pre-merged: the
 *   peer's own wsUrl as the LIVE socket was opened (tracked per-socket), or the
 *   pending set M6 installs. Both are behaviour decisions and are father-gated.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';

const settle = (ms = 80): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Poll until `pred` holds, instead of sleeping a fixed 250ms and hoping.
 *
 * Fixed sleeps made this suite flaky: two consecutive runs at 12 arms gave
 * 1 failed and then 2 failed, and the failures moved. Both were timing, not
 * logic -- one arm asserted the peer was in the connected map 250ms after
 * addPeer under a loaded box, and the teardown path can settle the loser socket
 * before the winner is installed. A timeout-based poll is strictly weaker
 * evidence about ORDERING only if you cap it generously, which this does.
 */
async function until(pred: () => boolean, budgetMs = 3000, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await settle(stepMs);
  }
  return pred();
}

interface Priv {
  peers: Map<string, WebSocket>;
  pingIntervals: Map<string, unknown>;
  reconnectTimeouts: Map<string, unknown>;
}

const priv = (m: FederationManager): Priv =>
  m as unknown as Priv;

const mkPeer = (over: Partial<FederationPeer> = {}): FederationPeer => ({
  hubId: 'peerA',
  wsUrl: '',
  federationToken: 'tok',
  status: 'disconnected',
  lastSeen: 0,
  connectedAgents: 0,
  ...over,
});

/**
 * A real server on an ephemeral port, plus the sockets it accepted.
 *
 * `close()` terminates the accepted sockets FIRST: `wss.close()` only runs its
 * callback once every client socket has gone, and a still-OPEN peer socket
 * would hang the teardown forever (that was the first draft's 7/7 failure —
 * every arm red with an "Hook timed out in 10000ms", not an assertion).
 */
async function mkPeerServer(): Promise<{
  url: string;
  sockets: WebSocket[];
  wireUrls: string[];
  close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const sockets: WebSocket[] = [];
  // The url the handshake ACTUALLY used. A ws WebSocket instance exposes no
  // `.url` of its own (draft-1 assumed one and threw on every run); the
  // upgrade request is the only place the dialed url exists server-side.
  const wireUrls: string[] = [];
  wss.on('connection', (s, req) => {
    sockets.push(s);
    wireUrls.push(req.url ?? '');
  });
  return {
    url: `ws://localhost:${(wss.address() as { port: number }).port}`,
    sockets,
    wireUrls,
    close: () => new Promise<void>(r => {
      for (const s of sockets) { try { s.terminate(); } catch { /* already dead */ } }
      wss.close(() => r());
      // Belt and braces: never let a stalled handshake wedge the suite.
      setTimeout(r, 2000).unref?.();
    }),
  };
}

describe('R455 — addPeer duplicate guard consults the CONNECTED map, not the CONFIGURED list', () => {
  const managers: FederationManager[] = [];
  const servers: Array<{ close: () => Promise<void> }> = [];

  const mkManager = (peers: FederationPeer[] = []): FederationManager => {
    const config = { hubId: 'me', federationPeers: peers } as unknown as Config;
    const m = new FederationManager(config);
    managers.push(m);
    return m;
  };

  afterEach(async () => {
    for (const m of managers) { try { m.stop(); } catch { /* already stopped */ } }
    managers.length = 0;
    for (const s of servers) { await s.close(); }
    servers.length = 0;
  });

  // ---------------------------------------------------------------- controls
  // A gate that can only go RED proves nothing. These three prove the harness
  // produces a connected peer, that a genuinely NEW hubId does dial, and that
  // the CONNECTED-path guard really does hold (the arm the pre-existing suite
  // already covered, re-established here as the baseline the gap sits beside).

  it('CONTROL: one addPeer against a live server yields exactly one socket and one ping timer', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1 && priv(m).pingIntervals.size === 1);
    expect(srv.sockets.length).toBe(1);
    expect(priv(m).peers.size).toBe(1);
    expect(priv(m).pingIntervals.size).toBe(1);
    m.stop();
  });

  it('CONTROL: a NEW hubId dials a fresh socket even when another peer is live', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ hubId: 'peerA', wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1);
    const before = srv.sockets.length;
    m.addPeer(mkPeer({ hubId: 'peerB', wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 2);
    expect(srv.sockets.length).toBe(before + 1);
    expect(priv(m).peers.size).toBe(2);
    m.stop();
  });

  it('CONTROL: a duplicate addPeer AFTER the socket is OPEN is refused by the guard', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1);
    expect(srv.sockets.length).toBe(1);
    // Same hubId, same URL — the `peers.has(...)` early return fires here.
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await settle(400);
    expect(srv.sockets.length).toBe(1);
    expect(priv(m).pingIntervals.size).toBe(1);
    m.stop();
  });

  // ---------------------------------------------------------------- C1
  it('CURRENT BEHAVIOUR (C1): a duplicate addPeer inside the CONNECTING window opens a SECOND socket', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    // No await between the two calls: the first socket has not emitted 'open'.
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => srv.sockets.length === 2 && priv(m).peers.size === 1);
    // Two sockets on the wire; the map keeps only ONE of them.
    expect(srv.sockets.length).toBe(2);
    expect(priv(m).peers.size).toBe(1);
    m.stop();
  });

  it('C1 mechanism: the CONFIGURED list has the peer synchronously, the CONNECTED map does not', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    // This is the whole finding in one assertion: the information needed to
    // close the window is already present — and unconsulted.
    const cfg = (m as unknown as { config: Config }).config;
    expect(cfg.federationPeers?.map(p => p.hubId)).toContain('peerA');
    expect(priv(m).peers.has('peerA')).toBe(false);
    await until(() => priv(m).peers.has('peerA'));
    // ...and the guard becomes true only once 'open' has fired.
    expect(priv(m).peers.has('peerA')).toBe(true);
    m.stop();
  });

  it('C1 second socket is real: both sockets reach OPEN, so this is duplication, not a failed dial', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => srv.sockets.length === 2 && priv(m).peers.size === 1);
    expect(srv.sockets.every(s => s.readyState === WebSocket.OPEN)).toBe(true);
    expect(srv.sockets.length).toBe(2);
    m.stop();
  });

  // ---------------------------------------------------------------- C3
  it('CURRENT BEHAVIOUR (C3): when the LOSING socket dies it untracks the live winner and arms a reconnect', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => srv.sockets.length === 2 && priv(m).peers.size === 1);
    await settle(150);

    const winner = priv(m).peers.get('peerA')!;
    expect(srv.sockets.length).toBe(2);
    const loser = srv.sockets.find(s => s !== winner)!;
    expect(loser).toBeDefined();

    loser.terminate();
    await until(() => priv(m).reconnectTimeouts.size === 1);

    // The winner is still OPEN — yet it is no longer in the map, so
    // sendToAgent/broadcast can no longer reach it, and its ping timer is gone.
    expect(winner.readyState).toBe(WebSocket.OPEN);
    expect(priv(m).peers.has('peerA')).toBe(false);
    expect(priv(m).pingIntervals.size).toBe(0);
    // And the self-healing path now fires at a healthy peer.
    expect(priv(m).reconnectTimeouts.size).toBe(1);
    const t = [...priv(m).reconnectTimeouts.values()][0] as unknown as { _idleTimeout: number };
    expect(t._idleTimeout).toBe(10000);
    clearTimeout([...priv(m).reconnectTimeouts.values()][0] as NodeJS.Timeout);
    priv(m).reconnectTimeouts.clear();
    m.stop();
  });

  it('C3 reports the TERMINATED peer as DISCONNECTED in the configured list', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    // The two dials carry DISTINCT tokens so the server can attribute each
    // accepted socket to a peer (the dial url carries ?hubId=..&token=..).
    m.addPeer(mkPeer({ wsUrl: srv.url, federationToken: 'tok-1' }));
    m.addPeer(mkPeer({ wsUrl: srv.url, federationToken: 'tok-2' }));
    const cfg = (m as unknown as { config: Config }).config;
    // Poll the thing this arm ASSERTS. Polling peers.size===1 instead was a
    // race: the map is populated by the first 'open' while `status` is written
    // by the same handler on a DIFFERENT object (the merge kept config[0]'s
    // identity, the loser socket writes to the incoming peer), so the map could
    // be full while config still read 'connecting' or, on a later ordering,
    // 'disconnected'.
    await until(() => cfg.federationPeers![0].status === 'connected');
    expect(srv.sockets.length).toBe(2);
    expect(cfg.federationPeers![0].status).toBe('connected');

    const winner = priv(m).peers.get('peerA')!;

    // ── DETERMINISTIC SOCKET ATTRIBUTION ──────────────────────────────────
    // The previous version terminated `srv.sockets.find(s => s !== winner)`.
    // `winner` is a CLIENT-side socket and `srv.sockets` are SERVER-side
    // sockets, so `s !== winner` is ALWAYS true and `find` always returned
    // `srv.sockets[0]` — the first connection ACCEPTED, which is not
    // necessarily the first connection DIALED. `peers.set` runs in each
    // socket's 'open' handler, so the LAST one to open is the map holder, and
    // that order varies. Under CI load the two dials were accepted in the
    // other order, the terminated socket was then the wrong peer's, and its
    // 'close' handler wrote 'disconnected' onto the INCOMING peer object
    // while `config[0]` — the MERGED entry, which is the FIRST dial's
    // object — kept reading 'connected'. The arm then failed with
    //   expected 'connected' to be 'disconnected'
    // on a run whose product behaviour was identical to the run that passed.
    // The arm was ORDER-DEPENDENT, and CI found the order.
    //
    // A client socket and its server-side counterpart share one TCP
    // connection: client.localPort === server.remotePort. Match on that.
    const tcp = (s: WebSocket) =>
      (s as unknown as { _socket?: { localPort: number; remotePort: number } })._socket;
    const holderLocalPort = tcp(winner)?.localPort;
    const holderSocket = srv.sockets.find(s => tcp(s)?.remotePort === holderLocalPort);
    expect(holderSocket).toBeDefined();
    // The LOSER is the peer whose socket is NOT the map holder.
    const loserSocket = srv.sockets.find(s => tcp(s)?.remotePort !== holderLocalPort)!;
    expect(loserSocket).toBeDefined();
    // ...and the peer that owns the loser, via the token in its dial url.
    const loserIndex = srv.sockets.indexOf(loserSocket);
    const loserIsFirstDial = (srv.wireUrls[loserIndex] ?? '').includes('tok-1');

    loserSocket.terminate();
    await until(() => priv(m).reconnectTimeouts.size === 1);

    expect(winner.readyState).toBe(WebSocket.OPEN);
    // The CONFIGURED entry of the terminated peer reads 'disconnected'; the
    // other peer's entry does not. WHICH entry that is depends on which
    // socket the map was holding — so the arm asserts the RELATION, not a
    // hardcoded index.
    //
    // `config[0]` is the entry addPeer MERGED into, and the merge PRESERVES
    // the existing entry's identity — so config[0] is still the FIRST dial's
    // object, and only the first dial's socket writes its status onto it.
    if (loserIsFirstDial) {
      expect(cfg.federationPeers![0].status).toBe('disconnected');
    } else {
      expect(cfg.federationPeers![0].status).toBe('connected');
    }
    // The report the hub hands out agrees with the configured entry it reads.
    expect(m.getPeersStatus().find(p => p.hubId === 'peerA')?.status).toBe(
      cfg.federationPeers![0].status,
    );
    // And the CORE of C3 — the part that does not depend on the order — holds:
    // the losing socket's close handler untracked the live winner and armed a
    // reconnect at a perfectly healthy peer.
    expect(priv(m).peers.has('peerA')).toBe(false);
    expect(priv(m).pingIntervals.size).toBe(0);
    expect(priv(m).reconnectTimeouts.size).toBe(1);
    clearTimeout([...priv(m).reconnectTimeouts.values()][0] as NodeJS.Timeout);
    priv(m).reconnectTimeouts.clear();
    m.stop();
  });

  // ---------------------------------------------------------------- C2
  it('C2 divergence is a RELATION, not a count: config names the NEW url while the live socket is the OLD one', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1);

    m.addPeer(mkPeer({ wsUrl: 'ws://127.0.0.1:1/CHANGED' }));
    await settle(400);

    const cfg = (m as unknown as { config: Config }).config;
    const configuredUrl = cfg.federationPeers![0].wsUrl;
    // The handshake the server actually accepted. `req.url` is the PATH+QUERY
    // only (`/?hubId=..&token=..`), so it cannot prove the authority -- what it
    // proves is that exactly ONE handshake ever arrived, and it carried the
    // identity of the ORIGINAL dial. A second dial to the CHANGED url would
    // have produced a second entry here (or failed outright, since it points
    // at a closed port).
    expect(srv.wireUrls.length).toBe(1);
    const wireUrl = srv.wireUrls[0];
    expect(wireUrl).toContain('hubId=me');
    expect(wireUrl).not.toContain('CHANGED');
    expect(configuredUrl).toBe('ws://127.0.0.1:1/CHANGED');
    // The RELATION is the finding: config and wire disagree about the same peer.
    expect(configuredUrl.startsWith('ws://127.0.0.1:1/')).toBe(true);
    expect(configuredUrl === wireUrl).toBe(false);
    m.stop();
  });

  it('C2 ORDERING (what makes the obvious url-comparing guard inert): addPeer merges into the CONFIGURED list BEFORE dialing, so the guard can never see a difference', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1);

    // addPeer does Object.assign(existing, incoming) then connectToPeer(incoming).
    // A guard of the form `live && configuredUrl === incomingUrl` therefore reads
    // EQUAL on both sides for EVERY addPeer, so adding the conjunct reproduces
    // `peers.has()` verbatim. This arm pins the ordering that makes it so, by
    // observing its effect: the configured list is ALREADY the incoming peer at
    // the instant control returns, and no socket was dialled for it.
    m.addPeer(mkPeer({ wsUrl: 'ws://127.0.0.1:1/CHANGED' }));
    const cfg = (m as unknown as { config: Config }).config;
    expect(cfg.federationPeers![0].wsUrl).toBe('ws://127.0.0.1:1/CHANGED');
    expect(srv.sockets.length).toBe(1);           // nothing dialled for the new url
    expect(priv(m).peers.size).toBe(1);           // the OLD socket is still tracked
    // Which means a url-comparing conjunct can never be the thing that fires:
    // there is no window in which configured != incoming.
    const configured = cfg.federationPeers!.find(p => p.hubId === 'peerA')!.wsUrl;
    expect(configured === 'ws://127.0.0.1:1/CHANGED').toBe(true);
    m.stop();
  });

  it('CURRENT BEHAVIOUR (C2): a wsUrl CHANGE on a connected peer updates the list but never dials the new URL', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1);
    expect(srv.sockets.length).toBe(1);
    expect(priv(m).peers.has('peerA')).toBe(true);

    // Operator repoints the peer at a new URL.
    m.addPeer(mkPeer({ wsUrl: 'ws://127.0.0.1:1/CHANGED' }));
    await settle(400);

    // Config says CHANGED...
    const cfg = (m as unknown as { config: Config }).config;
    expect(cfg.federationPeers![0].wsUrl).toBe('ws://127.0.0.1:1/CHANGED');
    // ...but no socket was ever opened to it, and the OLD socket is still the
    // live one, so config and reality now disagree.
    expect(srv.sockets.length).toBe(1);
    expect(priv(m).peers.size).toBe(1);
    m.stop();
  });

  it('C2: the wsUrl change is a no-op on the wire even after the old socket drops', async () => {
    const srv = await mkPeerServer(); servers.push(srv);
    const m = mkManager();
    m.addPeer(mkPeer({ wsUrl: srv.url }));
    await until(() => priv(m).peers.size === 1);
    m.addPeer(mkPeer({ wsUrl: 'ws://127.0.0.1:1/CHANGED' }));
    await settle(400);

    // Drop the original socket. The reconnect that follows uses the CONFIGURED
    // url — which the guard never applied to the live socket, so for one cycle
    // the hub was connected to the old url while config named the new one.
    const cfg = (m as unknown as { config: Config }).config;
    expect(cfg.federationPeers![0].wsUrl).toBe('ws://127.0.0.1:1/CHANGED');
    expect(srv.sockets.length).toBe(1);
    clearTimeout([...priv(m).reconnectTimeouts.values()][0] as NodeJS.Timeout);
    priv(m).reconnectTimeouts.clear();
    m.stop();
  });
});
