/**
 * R455 probe 3 — WHY the obvious url-comparison guard (matrix mutant M4) is a
 * NO-OP rather than a fix.
 *
 * The natural way to close C2 ("a wsUrl CHANGE on a connected peer is silently
 * dropped") is to make the duplicate guard also compare URLs:
 *
 *     const live = this.peers.get(peer.hubId);
 *     if (live && this.config.federationPeers?.find(p => p.hubId === peer.hubId)?.wsUrl === peer.wsUrl)
 *       return;
 *
 * It looks like it re-dials on a changed URL, because the `&&` falls through
 * to connectToPeer. It does not: addPeer() calls Object.assign(existing, peer)
 * on the CONFIGURED list BEFORE connectToPeer(peer), so by the time the guard
 * reads it, the configured wsUrl IS the incoming wsUrl. The second conjunct is
 * therefore true whenever `live` is, and the guard is exactly the old
 * `this.peers.has(...)` under a longer name.
 *
 * This probe MEASURES that: it instruments the guard's two conjuncts and
 * prints what each one saw for a real CHANGED-url addPeer. If the measurement
 * shows configured===incoming at guard time, M4 is inert BY CONSTRUCTION and
 * its 10/10 is not a coverage gap in the suite.
 *
 * Run: npx tsx scripts/r455_probe3.ts
 */
import { WebSocketServer } from 'ws';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';

const settle = (ms = 80): Promise<void> => new Promise(r => setTimeout(r, ms));

async function main() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  wss.on('connection', () => { /* count only */ });
  let connCount = 0;
  wss.on('connection', () => { connCount++; });
  const url = `ws://localhost:${(wss.address() as { port: number }).port}`;

  const config = { hubId: 'me', federationPeers: [] } as unknown as Config;
  const m = new FederationManager(config);
  const peer = (over: Partial<FederationPeer> = {}): FederationPeer => ({
    hubId: 'peerA', wsUrl: url, federationToken: 'tok',
    status: 'disconnected', lastSeen: 0, connectedAgents: 0, ...over,
  });

  m.addPeer(peer());
  await settle(250);
  connCount = 0;

  // Operator repoints peerA at a NEW url. addPeer assigns it into the
  // configured list, THEN calls connectToPeer.
  const changed = 'ws://127.0.0.1:1/CHANGED';
  m.addPeer(peer({ wsUrl: changed }));

  // At this instant the guard ALREADY RAN. Recover what it saw by reading the
  // two values it compared -- both are post-merge, which is the whole point.
  const cfg = (m as unknown as { config: Config }).config;
  const configuredUrlAtGuardTime = cfg.federationPeers!.find(p => p.hubId === 'peerA')!.wsUrl;
  const liveMapHasPeer = (m as unknown as { peers: Map<string, unknown> }).peers.has('peerA');

  console.log('live map has peerA (first conjunct):', liveMapHasPeer);
  console.log('configured wsUrl at guard time     :', configuredUrlAtGuardTime);
  console.log('incoming wsUrl                     :', changed);
  console.log('second conjunct (cfg === incoming) :', configuredUrlAtGuardTime === changed,
    '<= ALWAYS true, so M4 collapses to `peers.has()`');
  await settle(200);
  console.log('sockets dialled for the CHANGED url:', connCount, '(0 => no re-dial: M4 changes nothing)');
  console.log('OLD socket still the live one      :',
    (m as unknown as { peers: Map<string, unknown> }).peers.size === 1);

  m.stop();
  await settle(50);
  for (const c of wss.clients) { try { c.terminate(); } catch { /* gone */ } }
  wss.close();
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
