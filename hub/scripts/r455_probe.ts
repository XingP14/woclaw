/**
 * R455 probe — addPeer()'s duplicate guard consults the CONNECTED map, not the
 * CONFIGURED list, and passes the incoming object rather than the merged one.
 *
 * Two claims, both reachable from POST /federation/peers:
 *   C1  a second POST for a peer that is still CONNECTING opens a SECOND socket
 *   C2  a POST that CHANGES an already-connected peer's wsUrl is silently dropped
 */
import { WebSocketServer } from 'ws';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';

const settle = (ms = 80): Promise<void> => new Promise(r => setTimeout(r, ms));

let connCount = 0;

async function main() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const addr = wss.address() as { port: number };
  wss.on('connection', () => { connCount++; });
  const url = `ws://localhost:${addr.port}`;

  const mkPeer = (over: Partial<FederationPeer> = {}): FederationPeer => ({
    hubId: 'peerA', wsUrl: url, federationToken: 'tok',
    status: 'disconnected', lastSeen: 0, connectedAgents: 0, ...over,
  });

  // ---- C1: double addPeer while CONNECTING (no await between the two calls)
  {
    const config = { hubId: 'me', federationPeers: [] } as unknown as Config;
    const m = new FederationManager(config);
    m.addPeer(mkPeer());
    m.addPeer(mkPeer());          // still CONNECTING -> peers map empty
    await settle(250);
    const peersMap = (m as unknown as { peers: Map<string, unknown> }).peers;
    console.log('C1 sockets accepted by server:', connCount, '(expect 1, bug => 2)');
    console.log('C1 peers map size:', peersMap.size);
    console.log('C1 pingIntervals size:', (m as unknown as { pingIntervals: Map<string, unknown> }).pingIntervals.size);
    m.stop();
    await settle(50);
  }

  // ---- C2: change wsUrl of an already-CONNECTED peer
  {
    connCount = 0;
    const config = { hubId: 'me', federationPeers: [] } as unknown as Config;
    const m = new FederationManager(config);
    m.addPeer(mkPeer());
    await settle(250);
    console.log('C2 after first add: sockets', connCount, 'status', config.federationPeers![0].status);
    m.addPeer(mkPeer({ wsUrl: 'ws://localhost:1/CHANGED' }));
    await settle(200);
    console.log('C2 sockets after url change:', connCount, '(expect 1, bug => 1 with new url never dialled)');
    console.log('C2 configured url:', config.federationPeers![0].wsUrl);
    console.log('C2 logged Already connected? (peers map has entry):',
      (m as unknown as { peers: Map<string, unknown> }).peers.has('peerA'));
    m.stop();
    await settle(50);
  }

  // ---- control: a genuinely NEW hubId does connect
  {
    connCount = 0;
    const config = { hubId: 'me', federationPeers: [] } as unknown as Config;
    const m = new FederationManager(config);
    m.addPeer(mkPeer({ hubId: 'peerB' }));
    await settle(250);
    console.log('CONTROL new hubId sockets:', connCount, '(expect 1 => instrument works)');
    m.stop();
    await settle(50);
  }

  wss.close();
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
