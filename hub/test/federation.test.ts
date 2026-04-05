import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';
import fs from 'fs';

function mkTempDir() {
  const dir = `/tmp/woclaw-fed-test-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestConfig(peers: Partial<FederationPeer>[] = [{}]): Config {
  return {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: mkTempDir(),
    authToken: 'test-token',
    hubId: 'hub-test-local',
    federationPeers: peers.map(p => ({
      hubId: p.hubId || 'peer-1',
      wsUrl: p.wsUrl || 'ws://localhost:9999',
      federationToken: p.federationToken || 'peer-secret',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 0,
    })),
    federationPingIntervalMs: 5000,
  } as Config;
}

function createEmptyConfig(): Config {
  return {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: mkTempDir(),
    authToken: 'test-token',
    hubId: 'hub-test-empty',
    federationPeers: [],
    federationPingIntervalMs: 5000,
  } as Config;
}

describe('FederationManager (S24)', () => {
  let config: Config;
  let manager: FederationManager;

  beforeEach(() => {
    config = createTestConfig();
    manager = new FederationManager(config);
  });

  afterEach(() => {
    manager.stop();
  });

  it('initializes with empty peer list when no peers configured', () => {
    const emptyConfig = createEmptyConfig();
    const m = new FederationManager(emptyConfig);
    const peers = m.getPeersStatus();
    expect(peers).toEqual([]);
    m.stop();
  });

  it('getPeersStatus returns configured peers with initial status', () => {
    const peers = manager.getPeersStatus();
    expect(peers.length).toBe(1);
    expect(peers[0].hubId).toBe('peer-1');
    expect(peers[0].status).toBe('disconnected');
  });

  it('addPeer adds a new peer and updates status', () => {
    const newPeer: FederationPeer = {
      hubId: 'hub-remote-2',
      wsUrl: 'ws://192.168.1.100:8082',
      federationToken: 'secret-xyz',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 0,
    };
    manager.addPeer(newPeer);
    const peers = manager.getPeersStatus();
    expect(peers.length).toBe(2);
    const added = peers.find(p => p.hubId === 'hub-remote-2');
    expect(added).toBeTruthy();
  });

  it('addPeer updates existing peer if hubId already present', () => {
    const updatedPeer: FederationPeer = {
      hubId: 'peer-1', // same as existing
      wsUrl: 'ws://new-url.example.com:8082',
      federationToken: 'new-secret',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 5,
    };
    manager.addPeer(updatedPeer);
    const peers = manager.getPeersStatus();
    expect(peers.length).toBe(1); // still 1 peer
    expect(peers[0].wsUrl).toBe('ws://new-url.example.com:8082');
  });

  it('sendToAgent returns false when peer not connected', () => {
    const sent = manager.sendToAgent('peer-1', 'agent-x', { hello: 'world' });
    expect(sent).toBe(false); // peer not connected
  });

  it('broadcast does not throw when no peers connected', () => {
    expect(() => manager.broadcast({ type: 'test' })).not.toThrow();
  });

  it('stop cleans up all intervals and connections', () => {
    manager.addPeer({
      hubId: 'peer-extra',
      wsUrl: 'ws://localhost:9998',
      federationToken: 'secret',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 0,
    });
    manager.stop();
    // After stop, peers should still report but connection state is clean
    const peers = manager.getPeersStatus();
    expect(peers.length).toBe(2); // peers still in config
    // Calling stop again should not throw
    expect(() => manager.stop()).not.toThrow();
  });
});
