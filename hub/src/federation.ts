// WoClaw Multi-Hub Federation — Hub-to-Hub connections and cross-hub routing
// v1.0: Each WoClaw Hub can connect to peer Hubs and relay messages between them

import { WebSocket } from 'ws';
import type { FederationPeer, FederationMessage, Config } from './types.js';
import { errorMessage } from './errors.js';


// Federation logger helpers (`fedLog` / `fedWarn` / `fedError`) now
// live in hub/src/federation_log.ts (07-04 01:23 cron) so callers outside
// hub/src/federation.ts — notably hub/src/ws_server.ts (L65 + L74) — can also
// use the canonical `[WoClaw Federation] ` prefix without duplicating it.
// This replaces the previous file-local helpers that were declared here.
import { fedLog, fedWarn, fedError } from './federation_log.js';


export class FederationManager {
  private peers: Map<string, WebSocket> = new Map();  // hubId → WS connection
  private config: Config;
  private onRelayMessage: ((msg: FederationMessage) => void) | null = null;
  private onMemorySync: ((msg: FederationMessage) => void) | null = null;
  private pingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private getMemoriesForSync: (() => Promise<Array<{key: string; value: string; tags: string[]; importanceScore: number}>>) | null = null;
  private onReceiveFederatedMemory: ((mem: {key: string; value: string; tags: string[]; sourceHub: string}) => Promise<void>) | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  /** Register callback to fetch important memories for periodic sync */
  setMemoryProvider(provider: () => Promise<Array<{key: string; value: string; tags: string[]; importanceScore: number}>>): void {
    this.getMemoriesForSync = provider;
  }

  /** Register callback to handle incoming federated memories */
  setFederatedMemoryHandler(handler: (mem: {key: string; value: string; tags: string[]; sourceHub: string}) => Promise<void>): void {
    this.onReceiveFederatedMemory = handler;
  }

  /** Start connecting to all configured federation peers */
  start(): void {
    if (!this.config.federationPeers?.length) {
      fedLog('No peers configured');
      return;
    }
    for (const peer of this.config.federationPeers) {
      this.connectToPeer(peer);
    }
    // Start periodic memory sync if enabled
    this.startPeriodicSync();
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
    this.stopPeriodicSync();
  }

  /** Start periodic memory sync based on config */
  private startPeriodicSync(): void {
    const syncConfig = this.config.federationSync;
    if (!syncConfig?.enabled || !syncConfig.syncIntervalMs) return;
    this.syncInterval = setInterval(() => {
      this.syncImportantMemories().catch((err: unknown) => {
        fedError('Periodic sync error:', errorMessage(err));
      });
    }, syncConfig.syncIntervalMs);
    fedLog(`Periodic memory sync enabled (interval: ${syncConfig.syncIntervalMs}ms, threshold: ${syncConfig.importanceThreshold ?? 7.0})`);
  }

  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /** Register callback for relay messages from other hubs */
  setRelayHandler(handler: (msg: FederationMessage) => void): void {
    this.onRelayMessage = handler;
  }

  /** Register callback for federated memory sync messages */
  setMemorySyncHandler(handler: (msg: FederationMessage) => void): void {
    this.onMemorySync = handler;
  }

  /** Connect to a single peer Hub */
  private connectToPeer(peer: FederationPeer): void {
    if (this.peers.has(peer.hubId)) {
      fedLog(`Already connected to ${peer.hubId}`);
      return;
    }

    peer.status = 'connecting';
    fedLog(`Connecting to peer ${peer.hubId} at ${peer.wsUrl}`);

    const ws = new WebSocket(`${peer.wsUrl}?hubId=${this.config.hubId}&token=${peer.federationToken}`);

    ws.on('open', () => {
      fedLog(`Connected to peer ${peer.hubId}`);
      peer.status = 'connected';
      this.peers.set(peer.hubId, ws);
      this.startPing(peer);
      this.sendHubInfo(ws, peer.hubId);
    });

    ws.on('message', (data) => {
      try {
        const msg: FederationMessage = JSON.parse(data.toString());
        this.handleMessage(msg, peer.hubId);
      } catch (e: unknown) {
        fedError(`Invalid message from ${peer.hubId}:`, errorMessage(e));
      }
    });

    ws.on('close', (code, reason) => {
      fedLog(`Disconnected from ${peer.hubId} (code=${code})`);
      peer.status = 'disconnected';
      this.peers.delete(peer.hubId);
      this.stopPing(peer.hubId);
      this.scheduleReconnect(peer);
    });

    ws.on('error', (err: unknown) => {
      fedError(`Error with ${peer.hubId}:`, errorMessage(err));
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
      fedLog(`Reconnecting to ${peer.hubId}`);
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
        if (msg.payload && typeof msg.payload === 'object') {
          const p = msg.payload as { connectedAgents?: number };
          fedLog(`Hub info from ${msg.fromHubId}: ${p.connectedAgents ?? 0} agents`);
        }
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
      case 'memory_sync':
        // Federated memory entry from a peer hub
        if (msg.toHubId === this.config.hubId && this.onMemorySync) {
          this.onMemorySync(msg);
        } else if (msg.toHubId !== this.config.hubId) {
          this.relayMessage(msg);
        }
        break;
      case 'memory_request':
        // Request to pull all federated memories from a peer
        if (msg.toHubId === this.config.hubId && this.onMemorySync) {
          this.onMemorySync(msg);
        } else if (msg.toHubId !== this.config.hubId) {
          this.relayMessage(msg);
        }
        break;
      default:
        fedWarn(`Unknown message type from ${fromHubId}:`, msg.type);
    }
  }

  private async syncImportantMemories(): Promise<void> {
    if (!this.getMemoriesForSync) return;
    const threshold = this.config.federationSync?.importanceThreshold ?? 7.0;
    const memories = await this.getMemoriesForSync();
    const important = memories.filter(m => m.importanceScore >= threshold);
    if (!important.length) return;
    for (const mem of important) {
      this.syncMemory(mem.key, mem.value, mem.tags, this.config.hubId);
    }
    fedLog(`Periodic sync: ${important.length}/${memories.length} memories above threshold ${threshold}`);
  }

  /** Send a message to a specific agent on a peer Hub */
  sendToAgent(targetHubId: string, agentId: string, payload: unknown): boolean {
    const ws = this.peers.get(targetHubId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      fedWarn(`Not connected to ${targetHubId}`);
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

  /** Broadcast a federated memory entry to all connected peer Hubs */
  syncMemory(key: string, value: string, tags: string[], sourceHub: string): void {
    const payload = { key, value, tags, sourceHub, updatedAt: Date.now() };
    for (const [hubId, ws] of this.peers) {
      if (ws.readyState === WebSocket.OPEN) {
        const msg: FederationMessage = {
          type: 'memory_sync',
          fromHubId: this.config.hubId,
          toHubId: hubId,
          payload,
        };
        ws.send(JSON.stringify(msg));
      }
    }
    fedLog(`Synced memory '${key}' to ${this.peers.size} peers`);
  }

  /** Request federated memory entries from a specific peer hub */
  requestMemorySync(targetHubId: string): boolean {
    const ws = this.peers.get(targetHubId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      fedWarn(`Not connected to ${targetHubId} for memory sync`);
      return false;
    }
    const msg: FederationMessage = {
      type: 'memory_request',
      fromHubId: this.config.hubId,
      toHubId: targetHubId,
      payload: { since: 0 },  // request all federated memories
    };
    ws.send(JSON.stringify(msg));
    return true;
  }

  /** Broadcast a message to all connected peer Hubs */
  broadcast(payload: unknown): void {
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
  getPeersStatus(): Pick<FederationPeer, 'hubId' | 'wsUrl' | 'status' | 'lastSeen' | 'connectedAgents'>[] {
    return (this.config.federationPeers || []).map(p => ({
      hubId: p.hubId,
      wsUrl: p.wsUrl,
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
