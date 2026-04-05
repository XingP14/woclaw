// WoClaw Multi-Hub Federation — Hub-to-Hub connections and cross-hub routing
// v1.0: Each WoClaw Hub can connect to peer Hubs and relay messages between them

import { WebSocket } from 'ws';
import type { FederationPeer, FederationMessage, Config } from './types.js';

export class FederationManager {
  private peers: Map<string, WebSocket> = new Map();  // hubId → WS connection
  private config: Config;
  private onRelayMessage: ((msg: FederationMessage) => void) | null = null;
  private pingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  /** Start connecting to all configured federation peers */
  start(): void {
    if (!this.config.federationPeers?.length) {
      console.log('[WoClaw Federation] No peers configured');
      return;
    }
    for (const peer of this.config.federationPeers) {
      this.connectToPeer(peer);
    }
  }

  /** Gracefully disconnect from all peers */
  stop(): void {
    for (const [hubId, ws] of this.peers) {
      ws.close(1000, 'Hub shutting down');
    }
    this.peers.clear();
    for (const interval of this.pingIntervals.values()) clearInterval(interval);
    this.pingIntervals.clear();
    for (const timeout of this.reconnectTimeouts.values()) clearTimeout(timeout);
    this.reconnectTimeouts.clear();
  }

  /** Register callback for relay messages from other hubs */
  setRelayHandler(handler: (msg: FederationMessage) => void): void {
    this.onRelayMessage = handler;
  }

  /** Connect to a single peer Hub */
  private connectToPeer(peer: FederationPeer): void {
    if (this.peers.has(peer.hubId)) {
      console.log(`[WoClaw Federation] Already connected to ${peer.hubId}`);
      return;
    }

    peer.status = 'connecting';
    console.log(`[WoClaw Federation] Connecting to peer ${peer.hubId} at ${peer.wsUrl}`);

    const ws = new WebSocket(`${peer.wsUrl}?hubId=${this.config.hubId}&token=${peer.federationToken}`);

    ws.on('open', () => {
      console.log(`[WoClaw Federation] Connected to peer ${peer.hubId}`);
      peer.status = 'connected';
      this.peers.set(peer.hubId, ws);
      this.startPing(peer);
      this.sendHubInfo(ws, peer.hubId);
    });

    ws.on('message', (data) => {
      try {
        const msg: FederationMessage = JSON.parse(data.toString());
        this.handleMessage(msg, peer.hubId);
      } catch (e) {
        console.error(`[WoClaw Federation] Invalid message from ${peer.hubId}:`, e);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WoClaw Federation] Disconnected from ${peer.hubId} (code=${code})`);
      peer.status = 'disconnected';
      this.peers.delete(peer.hubId);
      this.stopPing(peer.hubId);
      this.scheduleReconnect(peer);
    });

    ws.on('error', (err) => {
      console.error(`[WoClaw Federation] Error with ${peer.hubId}:`, err.message);
    });
  }

  private startPing(peer: FederationPeer): void {
    const interval = setInterval(() => {
      const ws = this.peers.get(peer.hubId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
        peer.lastSeen = Date.now();
      }
    }, this.config.federationPingIntervalMs || 30000);
    this.pingIntervals.set(peer.hubId, interval);
  }

  private stopPing(hubId: string): void {
    const interval = this.pingIntervals.get(hubId);
    if (interval) { clearInterval(interval); this.pingIntervals.delete(hubId); }
  }

  private scheduleReconnect(peer: FederationPeer): void {
    const existing = this.reconnectTimeouts.get(peer.hubId);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
      console.log(`[WoClaw Federation] Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s
    this.reconnectTimeouts.set(peer.hubId, timeout);
  }

  private sendHubInfo(ws: WebSocket, toHubId: string): void {
    const msg: FederationMessage = {
      type: 'hub_info',
      fromHubId: this.config.hubId,
      toHubId,
      payload: {
        hubId: this.config.hubId,
        connectedAgents: this.countConnectedAgents(),
        topics: [],
      },
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private countConnectedAgents(): number {
    // This will be wired up via wsServer when integrated
    return 0;
  }

  private handleMessage(msg: FederationMessage, fromHubId: string): void {
    switch (msg.type) {
      case 'hub_info':
        console.log(`[WoClaw Federation] Hub info from ${msg.fromHubId}: ${msg.payload.connectedAgents} agents`);
        break;
      case 'agent_message':
        // A message from an agent on another hub addressed to us or to relay
        if (msg.toHubId === this.config.hubId && this.onRelayMessage) {
          this.onRelayMessage(msg);
        }
        break;
      case 'relay':
        // Relay a message to the next hop or final destination
        this.relayMessage(msg);
        break;
      default:
        console.warn(`[WoClaw Federation] Unknown message type from ${fromHubId}:`, msg.type);
    }
  }

  /** Send a message to a specific agent on a peer Hub */
  sendToAgent(targetHubId: string, agentId: string, payload: any): boolean {
    const ws = this.peers.get(targetHubId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WoClaw Federation] Not connected to ${targetHubId}`);
      return false;
    }
    const msg: FederationMessage = {
      type: 'agent_message',
      fromHubId: this.config.hubId,
      toHubId: targetHubId,
      agentId,
      payload,
    };
    ws.send(JSON.stringify(msg));
    return true;
  }

  /** Broadcast a message to all connected peer Hubs */
  broadcast(payload: any): void {
    for (const [hubId, ws] of this.peers) {
      if (ws.readyState === WebSocket.OPEN) {
        const msg: FederationMessage = {
          type: 'relay',
          fromHubId: this.config.hubId,
          toHubId: hubId,
          payload,
        };
        ws.send(JSON.stringify(msg));
      }
    }
  }

  private relayMessage(msg: FederationMessage): void {
    // If we're the destination, deliver to local agent
    if (msg.toHubId === this.config.hubId && this.onRelayMessage) {
      this.onRelayMessage(msg);
      return;
    }
    // Otherwise forward to the next hop
    const ws = this.peers.get(msg.toHubId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** Get status of all peers */
  getPeersStatus(): Pick<FederationPeer, 'hubId' | 'status' | 'lastSeen' | 'connectedAgents'>[] {
    return (this.config.federationPeers || []).map(p => ({
      hubId: p.hubId,
      status: p.status,
      lastSeen: p.lastSeen,
      connectedAgents: p.connectedAgents,
    }));
  }

  /** Manually add a new peer Hub (runtime, not persisted) */
  addPeer(peer: FederationPeer): void {
    if (!this.config.federationPeers) this.config.federationPeers = [];
    const existing = this.config.federationPeers.find(p => p.hubId === peer.hubId);
    if (existing) {
      Object.assign(existing, peer);
    } else {
      this.config.federationPeers.push(peer);
    }
    this.connectToPeer(peer);
  }
}
