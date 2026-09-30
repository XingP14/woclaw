/**
 * FederationManager over a REAL WebSocket peer (2026-10-01 03:03 cron tick).
 *
 * Why this file exists
 * --------------------
 * Every pre-existing federation suite is a NO-PEER-CONNECTED suite:
 *
 *   - federation.test.ts               — addPeer/getPeersStatus/sendToAgent/
 *                                        broadcast/stop, but `wsUrl` points at
 *                                        `ws://localhost:9999` where nothing
 *                                        listens, and it never awaits the
 *                                        socket, so `this.peers` stays empty.
 *   - federation_sync_important_memories.test.ts — drives the private
 *                                        syncImportantMemories() directly and
 *                                        explicitly asserts the
 *                                        "Synced memory 'k' to 0 peers" line.
 *   - federation_log.test.ts           — pins the 3 helper signatures only.
 *
 * That construction makes 15 of federation.ts's 47 branches structurally
 * unreachable: EVERY arm sits behind `ws.readyState === WebSocket.OPEN`, and
 * no test ever produced an OPEN socket. So `sendToAgent` can only ever return
 * false, `syncMemory` / `broadcast` / `relayMessage` can only ever loop over
 * an empty map, and none of the ws 'open' / 'message' / 'close' / 'error'
 * handlers has ever executed — which is also why the 4 handlers that feed
 * `handleMessage` (and therefore every `msg.type` case) are untested.
 *
 * These are not cosmetic branches. `ws.on('close')` -> `scheduleReconnect`
 * is the entire self-healing path for a peer hub that restarts; a regression
 * there leaves a federation permanently one-way with no test failing. And
 * `handleMessage`'s dispatch is what decides whether an inbound
 * `memory_sync` is delivered locally, relayed onward, or dropped as unknown.
 *
 * This file spins up a real `WebSocketServer` on an ephemeral port, points a
 * real FederationManager at it, and waits for the actual 'open' event, so the
 * OPEN-guard arms execute for real rather than being stubbed.
 *
 * Everything here is end-to-end through the public API plus bracket-notation
 * access to the private `peers` map for arrival assertions. 0 production
 * changes.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';
import fs from 'fs';

function mkTempDir(): string {
  const dir = `/tmp/woclaw-fed-live-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Give the socket a couple of event-loop turns to flush + deliver. */
const settle = (ms = 60): Promise<void> => new Promise(r => setTimeout(r, ms));

interface PeerHarness {
  manager: FederationManager;
  config: Config;
  peer: FederationPeer;
  /** Messages the peer hub received, in order. */
  received: any[];
  /** Server-side socket instances the harness is holding. */
  serverSockets: WebSocket[];
  wss: WebSocketServer;
  priv: {
    peers: Map<string, WebSocket>;
    pingIntervals: Map<string, NodeJS.Timeout>;
    reconnectTimeouts: Map<string, NodeJS.Timeout>;
    syncInterval: NodeJS.Timeout | null;
  };
  /** Wait until the manager has an OPEN socket for `hubId`. */
  waitConnected(hubId: string, timeoutMs?: number): Promise<void>;
  /** Push a raw frame (object or string) from the peer into the manager. */
  sendFromPeer(raw: unknown): Promise<void>;
  /** Terminate the peer socket, as a crashed peer hub would. */
  dropPeer(): Promise<void>;
  /**
   * Register an extra in-process peer hub (its own server + sockets) so
   * cleanup() tears it down. Needed for multi-hop tests: a second live peer
   * means a second ws.on('close') handler, and each one arms a 10s reconnect
   * timer AFTER stop() has already run (see the stop() leak test). Without
   * this, the vitest worker stays alive for 10s and the test times out.
   */
  trackServer(wss2: WebSocketServer): void;
  cleanup(): void;
}

async function startFederationWithLivePeer(
  peerCfg: Partial<FederationPeer> = {},
  configOverrides: Partial<Config> = {},
): Promise<PeerHarness> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const addr = wss.address() as { port: number };
  const wsUrl = `ws://127.0.0.1:${addr.port}`;

  const hubId = peerCfg.hubId || 'peer-live-1';
  const config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: mkTempDir(),
    authToken: 'test-token',
    hubId: 'hub-test-local',
    federationPeers: [{
      hubId,
      wsUrl,
      federationToken: 'peer-secret',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 3,
    }],
    // Long ping interval: the arms under test are about the connect/message
    // path, and a short interval would keep the event loop busy for nothing.
    federationPingIntervalMs: 60000,
    ...configOverrides,
  } as Config;

  const received: any[] = [];
  const serverSockets: WebSocket[] = [];
  wss.on('connection', (sock) => {
    serverSockets.push(sock);
    sock.on('message', (data) => {
      try { received.push(JSON.parse(data.toString())); } catch { received.push(data.toString()); }
    });
  });

  const manager = new FederationManager(config);
  const priv = manager as unknown as PeerHarness['priv'];

  const waitConnected = (targetHubId: string, timeoutMs = 4000): Promise<void> =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        const ws = priv.peers.get(targetHubId);
        if (ws && ws.readyState === WebSocket.OPEN) return resolve();
        if (Date.now() > deadline) return reject(new Error(`peer ${targetHubId} never opened`));
        setTimeout(poll, 10);
      };
      poll();
    });

  const clientSocket = (): WebSocket => priv.peers.get(hubId)!;

  const serverSocket = (): WebSocket => {
    if (serverSockets.length === 0) throw new Error('peer server socket not registered yet');
    return serverSockets[serverSockets.length - 1];
  };

  // The manager is a WS *client*; to inject an inbound frame we must write
  // from the server end. Sending on the manager's own client socket would put
  // the frame on the same path as manager.broadcast() and would never reach
  // the manager's `ws.on('message')` handler at all.
  const sendFromPeer = (raw: unknown): Promise<void> => new Promise((resolve) => {
    const payload = typeof raw === 'string' ? raw : JSON.stringify(raw);
    serverSocket().send(payload, () => resolve());
  });

  const dropPeer = (): Promise<void> => new Promise((resolve) => {
    const sock = clientSocket();
    if (!sock) return resolve();
    sock.once('close', () => resolve());
    sock.terminate();
  });

  // NOTE: addPeer takes the *config's own peer object*, not a copy.
  // connectToPeer mutates `peer.status` in place, and the only way a
  // getPeersStatus() caller observes 'connected' is if the object in
  // config.federationPeers is the same identity the manager connected with.
  // Passing a `{...peer}` copy (the obvious thing) leaves the config entry
  // stuck at 'disconnected' forever — a test-authoring trap worth naming.
  const peer = config.federationPeers![0];
  manager.addPeer(peer);
  await waitConnected(hubId);

  const extraServers: WebSocketServer[] = [];

  const harness: PeerHarness = {
    manager, config, peer, received, serverSockets, wss, priv,
    waitConnected, sendFromPeer, dropPeer,
    trackServer(wss2) { extraServers.push(wss2); },
    cleanup() {
      try { manager.stop(); } catch { /* already stopped */ }
      // stop() does NOT prevent the ws 'close' handlers it just triggered
      // from re-arming reconnect timers (documented in the stop() leak test
      // below), so drain them explicitly before we finish or the worker
      // stays alive for 10s per peer.
      for (const t of priv.reconnectTimeouts.values()) clearTimeout(t);
      priv.reconnectTimeouts.clear();
      for (const t of priv.pingIntervals.values()) clearInterval(t);
      priv.pingIntervals.clear();
      if (priv.syncInterval) { clearInterval(priv.syncInterval); priv.syncInterval = null; }
      for (const s of serverSockets) { try { s.terminate(); } catch { /* gone */ } }
      for (const s of priv.peers.values()) { try { s.terminate(); } catch { /* gone */ } }
      try { wss.close(); } catch { /* already closed */ }
      for (const s2 of extraServers) {
        try { s2.close(); } catch { /* already closed */ }
      }
      try { fs.rmSync(config.dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
  return harness;
}

describe('FederationManager over a live peer WebSocket (S24 live)', () => {
  let h: PeerHarness | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (h) {
      h.cleanup();
      h = null;
    }
    // Let any close/error handler that a test deliberately triggered finish
    // firing before the next test starts its own server, so its stdout does
    // not interleave into the next test's block.
    await settle(30);
  });

  // ---------------------------------------------------------------------
  // connectToPeer: the ws.on('open') arm
  // ---------------------------------------------------------------------

  it('registers the peer as OPEN, flips status, and sends hub_info on connect', async () => {
    h = await startFederationWithLivePeer();
    const ws = h.priv.peers.get('peer-live-1');
    expect(ws).toBeDefined();
    expect(ws!.readyState).toBe(WebSocket.OPEN);
    // peer.status walked disconnected -> connecting -> connected
    expect(h.peer.status).toBe('connected');

    const info = await vi.waitFor(() => {
      const m = h!.received.find(x => x?.type === 'hub_info');
      expect(m).toBeTruthy();
      return m!;
    });
    expect(info.fromHubId).toBe('hub-test-local');
    expect(info.toHubId).toBe('peer-live-1');
    expect(info.payload.hubId).toBe('hub-test-local');
    expect(info.payload.topics).toEqual([]);
    // sendHubInfo's readyState guard passed, so the frame really went out.
    expect(typeof info.payload.connectedAgents).toBe('number');
  });

  it('connectToPeer logs "Already connected" and opens no second socket for a live hubId', async () => {
    h = await startFederationWithLivePeer();
    const before = h.received.length;
    const logSpy = vi.spyOn(console, 'log');
    // Same hubId, a deliberately different (dead) wsUrl. addPeer takes the
    // `existing` Object.assign branch and calls connectToPeer again, which
    // must short-circuit on `this.peers.has(peer.hubId)` — otherwise the dead
    // URL would be dialed and the good connection torn down.
    h.manager.addPeer({
      hubId: 'peer-live-1',
      wsUrl: 'ws://127.0.0.1:1',
      federationToken: 'other',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 9,
    });
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('Already connected to peer-live-1'))).toBe(true);
    await settle();
    expect(h.received.length).toBe(before);
    expect(h.serverSockets.length).toBe(1);
    // The live socket survived the redundant add.
    expect(h.priv.peers.get('peer-live-1')!.readyState).toBe(WebSocket.OPEN);
  });

  // ---------------------------------------------------------------------
  // sendToAgent: both readyState arms
  // ---------------------------------------------------------------------

  it('sendToAgent delivers over the OPEN socket and returns true', async () => {
    h = await startFederationWithLivePeer();
    expect(h.manager.sendToAgent('peer-live-1', 'agent-x', { hello: 'world' })).toBe(true);
    const sent = await vi.waitFor(() => {
      const m = h!.received.find(x => x?.type === 'agent_message');
      expect(m).toBeTruthy();
      return m!;
    });
    expect(sent.toHubId).toBe('peer-live-1');
    expect(sent.agentId).toBe('agent-x');
    expect(sent.payload).toEqual({ hello: 'world' });
  });

  it('sendToAgent returns false for an unknown hub with the "Not connected" warning', async () => {
    h = await startFederationWithLivePeer();
    const warnSpy = vi.spyOn(console, 'warn');
    expect(h.manager.sendToAgent('nobody-here', 'agent-x', {})).toBe(false);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('Not connected to nobody-here'))).toBe(true);
  });

  it('requestMemorySync sends a since:0 request over the OPEN socket', async () => {
    h = await startFederationWithLivePeer();
    expect(h.manager.requestMemorySync('peer-live-1')).toBe(true);
    const req = await vi.waitFor(() => {
      const m = h!.received.find(x => x?.type === 'memory_request');
      expect(m).toBeTruthy();
      return m!;
    });
    expect(req.payload).toEqual({ since: 0 });
  });

  it('requestMemorySync returns false and warns for an unconnected peer', async () => {
    h = await startFederationWithLivePeer();
    const warnSpy = vi.spyOn(console, 'warn');
    expect(h.manager.requestMemorySync('ghost-hub')).toBe(false);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('for memory sync'))).toBe(true);
  });

  // ---------------------------------------------------------------------
  // syncMemory / broadcast: the loop-over-peers arms
  // ---------------------------------------------------------------------

  it('syncMemory broadcasts to the OPEN peer and logs a 1-peer count', async () => {
    h = await startFederationWithLivePeer();
    const logSpy = vi.spyOn(console, 'log');
    h.manager.syncMemory('k1', 'v1', ['tag-a'], 'hub-test-local');
    const sync = await vi.waitFor(() => {
      const m = h!.received.find(x => x?.type === 'memory_sync');
      expect(m).toBeTruthy();
      return m!;
    });
    expect(sync.toHubId).toBe('peer-live-1');
    expect(sync.payload.key).toBe('k1');
    expect(sync.payload.value).toBe('v1');
    expect(sync.payload.tags).toEqual(['tag-a']);
    expect(sync.payload.sourceHub).toBe('hub-test-local');
    expect(typeof sync.payload.updatedAt).toBe('number');
    // The "to N peers" count is 1 here; every prior test in the repo asserted
    // the 0-peer variant because it had no connected socket.
    expect(logSpy.mock.calls.some(c => String(c[0]).includes("Synced memory 'k1' to 1 peers"))).toBe(true);
  });

  it('broadcast fans a relay frame out to the OPEN peer', async () => {
    h = await startFederationWithLivePeer();
    h.manager.broadcast({ type: 'ping' });
    const relay = await vi.waitFor(() => {
      const m = h!.received.find(x => x?.type === 'relay');
      expect(m).toBeTruthy();
      return m!;
    });
    expect(relay.payload).toEqual({ type: 'ping' });
  });

  it('relayMessage forwards a memory_sync to a SECOND connected peer', async () => {
    // The single-peer setup cannot observe a relay at all: relayMessage looks
    // up `peers.get(toHubId)`, and with only one peer that lookup is either
    // our own socket (self-echo) or undefined. A relay is only observable
    // with a real second hop, which is what this test builds.
    const wss2 = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(r => wss2.once('listening', () => r()));
    const port2 = (wss2.address() as { port: number }).port;
    const hops: any[] = [];
    wss2.on('connection', (s) => s.on('message', (d) => { try { hops.push(JSON.parse(d.toString())); } catch { /* ignore */ } }));

    h = await startFederationWithLivePeer();
    h.trackServer(wss2);
    // Register a second, separately-tracked peer directly in the config so
    // connectToPeer dials hop 2 as well.
    h.manager.addPeer({
      hubId: 'peer-hop-2', wsUrl: `ws://127.0.0.1:${port2}`, federationToken: 'hop2',
      status: 'disconnected', lastSeen: 0, connectedAgents: 1,
    });
    await h.waitConnected('peer-hop-2');

    // memory_sync addressed to peer-hop-2 must be relayed, not delivered
    // locally and not dropped.
    await h.sendFromPeer({ type: 'memory_sync', fromHubId: 'peer-live-1', toHubId: 'peer-hop-2', payload: { key: 'relayed' } });
    const relayed = await vi.waitFor(() => {
      const m = hops.find(x => x?.type === 'memory_sync' && x?.payload?.key === 'relayed');
      expect(m).toBeTruthy();
      return m!;
    });
    expect(relayed.toHubId).toBe('peer-hop-2');
    // FINDING (pinned, not fixed — 0 production changes this tick): the
    // forwarding hub relays the frame VERBATIM. It does NOT re-stamp
    // fromHubId with its own id, so `fromHubId` stays the ORIGINAL sender
    // (`peer-live-1`), not `hub-test-local`. On a 2+ hop federation that
    // means the final receiver sees the originating hub and has no way to
    // learn which intermediate hub carried the message. The original
    // sender is preserved (arguably the more useful half) but the relay
    // chain is invisible. asserted below as-is so a future fix is a
    // deliberate, visible test change.
    expect(relayed.fromHubId).toBe('peer-live-1');
    expect(relayed.fromHubId).not.toBe('hub-test-local');
    // The payload also travels untouched — no sourceHub re-stamp either.
    expect(relayed.payload).toEqual({ key: 'relayed' });
    // wss2 is torn down by afterEach -> h.cleanup() -> trackServer.
  });

  it('relayMessage drops a memory_sync for an unreachable third hub, silently', async () => {
    h = await startFederationWithLivePeer();
    const got: any[] = [];
    h.manager.setMemorySyncHandler(m => got.push(m));
    const before = h.received.length;
    // `peers` holds only peer-live-1, so relayMessage finds no socket and
    // drops the frame — no send, no local delivery, and NO warning, unlike
    // sendToAgent/requestMemorySync which do warn. Pin that asymmetry: an
    // operator debugging a missing federation memory has no log line to find.
    await h.sendFromPeer({ type: 'memory_sync', fromHubId: 'peer-live-1', toHubId: 'far-hub-9', payload: { key: 'k9' } });
    await settle();
    const warnSpy = vi.spyOn(console, 'warn');
    await h.sendFromPeer({ type: 'memory_sync', fromHubId: 'peer-live-1', toHubId: 'far-hub-9', payload: { key: 'k10' } });
    await settle();
    expect(got.length).toBe(0);
    expect(h.received.length).toBe(before);
    expect(warnSpy.mock.calls.filter(c => String(c[0]).includes('far-hub-9'))).toEqual([]);
    expect(warnSpy.mock.calls.filter(c => String(c[0]).includes('Not connected'))).toEqual([]);
  });

  it('broadcast and syncMemory skip a peer whose socket is not OPEN', async () => {
    h = await startFederationWithLivePeer();
    const before = h.received.length;
    // Replace the map entry with a CONNECTING-shaped socket: the exact state a
    // peer sits in between addPeer() and the 'open' event.
    const fake = Object.create(WebSocket.prototype) as WebSocket;
    Object.defineProperty(fake, 'readyState', { value: WebSocket.CONNECTING });
    h.priv.peers.set('peer-live-1', fake);
    h.manager.broadcast({ type: 'should-not-arrive' });
    h.manager.syncMemory('k2', 'v2', [], 'hub-test-local');
    await settle();
    expect(h.received.length).toBe(before);
    // ...but the "N peers" log still counts the map entry, not the open ones.
    // That is the real behaviour and is what an operator reading logs sees.
  });

  // ---------------------------------------------------------------------
  // handleMessage: the whole type dispatch
  // ---------------------------------------------------------------------

  it('delivers an inbound agent_message addressed to this hub', async () => {
    h = await startFederationWithLivePeer();
    const got: any[] = [];
    h.manager.setRelayHandler(m => got.push(m));
    await h.sendFromPeer({
      type: 'agent_message',
      fromHubId: 'peer-live-1',
      toHubId: 'hub-test-local',
      agentId: 'agent-remote',
      payload: { q: 'hello' },
    });
    await vi.waitFor(() => expect(got.length).toBe(1));
    expect(got[0].agentId).toBe('agent-remote');
  });

  it('drops an agent_message addressed to a different hub and never relays it back', async () => {
    h = await startFederationWithLivePeer();
    const got: any[] = [];
    h.manager.setRelayHandler(m => got.push(m));
    const before = h.received.length;
    await h.sendFromPeer({
      type: 'agent_message',
      fromHubId: 'peer-live-1',
      toHubId: 'some-third-hub',
      agentId: 'a',
      payload: {},
    });
    await settle();
    // The `agent_message` case has no else-branch: an off-hub agent message
    // is DROPPED, not relayed. Only `relay` and the memory_* types forward.
    expect(got.length).toBe(0);
    expect(h.received.length).toBe(before);
  });

  it('logs hub_info for this hub, swallows a null payload, and defaults a missing agent count to 0', async () => {
    h = await startFederationWithLivePeer();
    const logSpy = vi.spyOn(console, 'log');

    await h.sendFromPeer({ type: 'hub_info', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: { connectedAgents: 5 } });
    await vi.waitFor(() =>
      expect(logSpy.mock.calls.some(c => String(c[0]).includes('Hub info from peer-live-1: 5 agents'))).toBe(true));

    // null payload: `msg.payload &&` is falsy, so the inner log is skipped and
    // the frame is dropped silently (no warn, no throw).
    logSpy.mockClear();
    await h.sendFromPeer({ type: 'hub_info', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: null });
    await settle();
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('Hub info from'))).toBe(false);

    // {} payload with connectedAgents absent: the `?? 0` arm.
    logSpy.mockClear();
    await h.sendFromPeer({ type: 'hub_info', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: {} });
    await vi.waitFor(() =>
      expect(logSpy.mock.calls.some(c => String(c[0]).includes('Hub info from peer-live-1: 0 agents'))).toBe(true));

    // A NON-object payload (a bare string) must take the same swallow path.
    // `msg.payload &&` is truthy but `typeof === 'object'` is false, so the
    // frame is dropped without a log. This is the second half of the two-part
    // guard; mutating the guard to `||` (making the string case log) must be
    // caught, so assert the string case produces NO "Hub info" line.
    logSpy.mockClear();
    await h.sendFromPeer({ type: 'hub_info', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: 'not-an-object' });
    await settle();
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('Hub info from'))).toBe(false);
  });

  it('handles memory_sync and memory_request for us, and drops them for a hub we cannot reach', async () => {
    h = await startFederationWithLivePeer();
    const got: any[] = [];
    h.manager.setMemorySyncHandler(m => got.push(m));

    await h.sendFromPeer({ type: 'memory_sync', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: { key: 'k' } });
    await vi.waitFor(() => expect(got.length).toBe(1));
    expect(got[0].type).toBe('memory_sync');

    await h.sendFromPeer({ type: 'memory_request', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: { since: 0 } });
    await vi.waitFor(() => expect(got.length).toBe(2));
    expect(got[1].type).toBe('memory_request');

    // Addressed to a third hub: relayMessage looks us up in `peers`, finds
    // nothing, and drops it. No send, no local delivery, no warning.
    const before = h.received.length;
    got.length = 0;
    await h.sendFromPeer({ type: 'memory_sync', fromHubId: 'peer-live-1', toHubId: 'far-hub-9', payload: { key: 'k9' } });
    await settle();
    expect(got.length).toBe(0);
    expect(h.received.length).toBe(before);
  });

  it('relayMessage delivers to the local relay handler when the message is for us', async () => {
    h = await startFederationWithLivePeer();
    const got: any[] = [];
    h.manager.setRelayHandler(m => got.push(m));
    await h.sendFromPeer({ type: 'relay', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: { r: 1 } });
    await vi.waitFor(() => expect(got.length).toBe(1));
    expect(got[0].payload).toEqual({ r: 1 });
  });

  it('warns on an unknown message type and survives a malformed frame', async () => {
    h = await startFederationWithLivePeer();
    const warnSpy = vi.spyOn(console, 'warn');
    const errSpy = vi.spyOn(console, 'error');
    const got: any[] = [];
    h.manager.setRelayHandler(m => got.push(m));

    await h.sendFromPeer({ type: 'totally_unknown', fromHubId: 'peer-live-1', payload: {} });
    await vi.waitFor(() =>
      expect(warnSpy.mock.calls.some(c => String(c[0]).includes('Unknown message type from peer-live-1'))).toBe(true));

    // A non-JSON frame must be caught by the ws 'message' try/catch and
    // logged, not thrown out of the socket callback.
    await h.sendFromPeer('this-is-not-json{{{');
    await vi.waitFor(() =>
      expect(errSpy.mock.calls.some(c => String(c[0]).includes('Invalid message from peer-live-1'))).toBe(true));

    // The socket is still alive and still routing after the bad frame.
    await h.sendFromPeer({ type: 'relay', fromHubId: 'peer-live-1', toHubId: 'hub-test-local', payload: { ok: true } });
    await vi.waitFor(() => expect(got.length).toBe(1));
  });

  // ---------------------------------------------------------------------
  // close -> stopPing -> scheduleReconnect: the self-healing path
  // ---------------------------------------------------------------------

  it('drops the peer from the map on close and marks it disconnected', async () => {
    h = await startFederationWithLivePeer();
    expect(h.priv.peers.has('peer-live-1')).toBe(true);
    await h.dropPeer();
    await vi.waitFor(() => expect(h!.priv.peers.has('peer-live-1')).toBe(false));
    expect(h.peer.status).toBe('disconnected');
  });

  it('stop() clears the peer map, ping timers and the sync interval, and is idempotent', async () => {
    h = await startFederationWithLivePeer();
    const ws = h.priv.peers.get('peer-live-1')!;
    // startPing ran once on 'open'.
    expect(h.priv.pingIntervals.size).toBe(1);

    h.manager.stop();
    expect(h.priv.peers.size).toBe(0);
    expect(h.priv.pingIntervals.size).toBe(0);
    expect(h.priv.syncInterval).toBeNull();
    expect(() => h!.manager.stop()).not.toThrow();
    // ws.close(1000, 'Hub shutting down') — a CLEAN close, not an abort.
    await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
  });

  /**
   * KEY FINDING — a real stop() leak, pinned as behaviour rather than fixed
   * (0 production changes is the rule for this tick).
   *
   * `stop()` (L56-66) iterates `reconnectTimeouts` and clears them, then calls
   * `stopPeriodicSync()`. But `stop()` only calls `ws.close(1000, ...)` on each
   * peer socket — and the ws 'close' handler it registered in `connectToPeer`
   * then fires ASYNCHRONOUSLY, AFTER stop() has already emptied the maps. That
   * handler calls `scheduleReconnect(peer)`, which installs a fresh 10s
   * setTimeout into the just-cleared `reconnectTimeouts` map.
   *
   * The upshot: a hub that is shut down while holding peer connections comes
   * back to life 10 seconds later with a live reconnect timer for every peer,
   * and a process that does not exit. `peers.size` and `pingIntervals` are
   * correctly 0 (this test asserts that), which is exactly why the existing
   * `stop cleans up all intervals and connections` test in federation.test.ts
   * passes today — it never had a live socket, so no close handler ever ran.
   *
   * If this is ever fixed in production (a `stopped` flag checked in
   * connectToPeer's close handler is the obvious fix), this assertion is the
   * one that must be flipped to 0.
   */
  it('stop() leaves a reconnect timer armed when it shuts down a LIVE peer socket', async () => {
    h = await startFederationWithLivePeer();
    expect(h.priv.reconnectTimeouts.size).toBe(0);

    h.manager.stop();
    await vi.waitFor(() => expect(h!.priv.reconnectTimeouts.size).toBe(1));
    // And it is a real 10s timer, not a stale bookkeeping entry.
    const timer = [...h.priv.reconnectTimeouts.values()][0] as unknown as {
      _idleTimeout: number; hasRef: () => boolean;
    };
    expect(timer._idleTimeout).toBe(10000);
    expect(timer.hasRef()).toBe(true);

    // Clear it so this test does not keep the vitest worker alive for 10s.
    clearTimeout([...h.priv.reconnectTimeouts.values()][0]);
    h.priv.reconnectTimeouts.clear();
  });

  it('re-arming an already-connected peer keeps exactly one ping timer', async () => {
    h = await startFederationWithLivePeer();
    expect(h.priv.pingIntervals.size).toBe(1);
    // startPing ran once on 'open'. A duplicate connect is the only way to get
    // a second entry, and connectToPeer guards that — assert the map still
    // has exactly one entry after a redundant addPeer.
    h.manager.addPeer({
      hubId: 'peer-live-1', wsUrl: 'ws://127.0.0.1:1', federationToken: 't',
      status: 'disconnected', lastSeen: 0, connectedAgents: 0,
    });
    expect(h.priv.pingIntervals.size).toBe(1);
  });

  it('addPeer Object.assign keeps the ORIGINAL hubId — a rename would orphan a live connection', () => {
    const cfg = {
      port: 0, restPort: 0, host: '127.0.0.1', dataDir: mkTempDir(),
      authToken: 't', hubId: 'hub-x', federationPeers: [
        { hubId: 'orig-hub', wsUrl: 'ws://127.0.0.1:1', federationToken: 'a', status: 'connected' as const, lastSeen: 5, connectedAgents: 2 },
      ],
      federationPingIntervalMs: 60000,
    } as Config;
    const m = new FederationManager(cfg);
    // Same identity, and the incoming object also carries hubId: 'orig-hub'
    // (the `existing` lookup matched on it). A rewrite that renamed the entry
    // would change the key `peers` is indexed by, orphaning the live socket
    // and leaking its ping timer. Assert the id is preserved and the OTHER
    // fields are overwritten.
    m.addPeer({ hubId: 'orig-hub', wsUrl: 'ws://127.0.0.1:2', federationToken: 'b', status: 'disconnected', lastSeen: 0, connectedAgents: 7 });
    expect(cfg.federationPeers!.length).toBe(1);
    expect(cfg.federationPeers![0].hubId).toBe('orig-hub');
    expect(cfg.federationPeers![0].wsUrl).toBe('ws://127.0.0.1:2');
    expect(cfg.federationPeers![0].federationToken).toBe('b');
    expect(cfg.federationPeers![0].connectedAgents).toBe(7);
    m.stop();
    try { fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  /**
   * EQUIVALENT MUTANT — documented, do NOT count as a coverage gap.
   *
   * `Object.assign(existing, peer)` (L333) and
   * `Object.assign(existing, { ...peer, hubId: existing.hubId })` are
   * observationally identical for every reachable input, because `existing`
   * was located by `p.hubId === peer.hubId` — so `existing.hubId` and
   * `peer.hubId` are the same string by construction, and re-pinning it is a
   * no-op. Verified: this exact mutant survives the whole 26-test file.
   *
   * The `hubId` assertion above is still worth keeping (it pins the identity
   * guarantee that makes `peers` map lookups stable) but it cannot kill that
   * mutant, and no test ever will. The other Object.assign mutations —
   * dropping the branch entirely, or flipping it to a `push` — ARE killed.
   */

  // ---------------------------------------------------------------------
  // start() / getPeersStatus() config-shape arms
  // ---------------------------------------------------------------------

  it('start() with an empty peer array logs and returns without connecting', () => {
    const logSpy = vi.spyOn(console, 'log');
    const emptyConfig = {
      port: 0, restPort: 0, host: '127.0.0.1', dataDir: mkTempDir(),
      authToken: 't', hubId: 'hub-empty', federationPeers: [],
      federationPingIntervalMs: 60000,
    } as Config;
    const m = new FederationManager(emptyConfig);
    m.start();
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('No peers configured'))).toBe(true);
    expect(m.getPeersStatus()).toEqual([]);
    m.stop();
    try { fs.rmSync(emptyConfig.dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('start() with federationPeers undefined takes the same no-peer early return', () => {
    const logSpy = vi.spyOn(console, 'log');
    const noPeersKeyConfig = {
      port: 0, restPort: 0, host: '127.0.0.1', dataDir: mkTempDir(),
      authToken: 't', hubId: 'hub-no-key', federationPingIntervalMs: 60000,
    } as Config;
    // `federationPeers` is genuinely absent — this is the `?.` arm, distinct
    // from the empty-array arm above.
    expect((noPeersKeyConfig as any).federationPeers).toBeUndefined();
    const m = new FederationManager(noPeersKeyConfig);
    m.start();
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('No peers configured'))).toBe(true);
    expect(m.getPeersStatus()).toEqual([]);
    m.stop();
    try { fs.rmSync(noPeersKeyConfig.dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('getPeersStatus returns [] when federationPeers is undefined, and addPeer materialises the array', () => {
    const cfg = {
      port: 0, restPort: 0, host: '127.0.0.1', dataDir: mkTempDir(),
      authToken: 't', hubId: 'hub-lazy', federationPingIntervalMs: 60000,
    } as Config;
    const m = new FederationManager(cfg);
    // The `|| []` arm at L319.
    expect(m.getPeersStatus()).toEqual([]);
    // addPeer must create the array before pushing (L330).
    m.addPeer({ hubId: 'p1', wsUrl: 'ws://127.0.0.1:1', federationToken: 't', status: 'disconnected', lastSeen: 0, connectedAgents: 0 });
    expect(Array.isArray(cfg.federationPeers)).toBe(true);
    expect(cfg.federationPeers!.length).toBe(1);
    m.stop();
    try { fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('getPeersStatus reports the live peer as connected with its configured agent count', async () => {
    h = await startFederationWithLivePeer();
    const status = h.manager.getPeersStatus();
    expect(status.length).toBe(1);
    expect(status[0].status).toBe('connected');
    expect(status[0].connectedAgents).toBe(3);
    expect(status[0].wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });
});
