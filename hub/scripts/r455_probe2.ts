/**
 * R455 probe 2 — the SECOND-ORDER consequence of C1: the losing socket's
 * 'close' handler deletes the map entry the WINNING socket installed, and
 * arms a reconnect. So a duplicate POST disarms the self-healing path.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';

const settle = (ms = 80): Promise<void> => new Promise(r => setTimeout(r, ms));

async function main() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const addr = wss.address() as { port: number };
  const sockets: WebSocket[] = [];
  wss.on('connection', (s) => sockets.push(s));
  const url = `ws://localhost:${addr.port}`;

  const config = { hubId: 'me', federationPeers: [] } as unknown as Config;
  const m = new FederationManager(config);
  const peer = (): FederationPeer => ({
    hubId: 'peerA', wsUrl: url, federationToken: 'tok',
    status: 'disconnected', lastSeen: 0, connectedAgents: 0,
  });

  m.addPeer(peer());
  m.addPeer(peer());
  await settle(300);

  const priv = m as unknown as {
    peers: Map<string, WebSocket>;
    pingIntervals: Map<string, unknown>;
    reconnectTimeouts: Map<string, unknown>;
  };
  console.log('sockets opened:', sockets.length);
  console.log('peers map size:', priv.peers.size);
  const winner = priv.peers.get('peerA')!;

  // Close ONLY the losing socket (the one NOT in the map) and see what happens
  // to the winner's bookkeeping.
  const loser = sockets.find(s => s !== winner)!;
  loser.terminate();
  await settle(200);
  console.log('after LOSER close -> peers map has peerA:', priv.peers.has('peerA'),
    '(the live winner is untracked)');
  console.log('after LOSER close -> reconnectTimeout armed:', priv.reconnectTimeouts.size,
    '(=> a duplicate POST armed a reconnect to a healthy peer)');
  console.log('after LOSER close -> pingIntervals:', priv.pingIntervals.size);
  console.log('peer status reported:', config.federationPeers![0].status);

  m.stop();
  await settle(50);
  wss.close();
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
