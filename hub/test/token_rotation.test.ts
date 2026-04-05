import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { Config } from '../src/types.js';
import fs from 'fs';

function mkTempDir() {
  const dir = `/tmp/woclaw-test-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createConfig(tempDir: string): Config {
  return {
    port: 0,  // random available port
    restPort: 0,
    host: '127.0.0.1',
    dataDir: tempDir,
    authToken: 'initial-token-abc',
    tokenGracePeriodMs: 3000, // 3 seconds
  };
}

describe('Token Rotation (S22)', () => {
  let tempDir: string;
  let db: ClawDB;
  let wsServer!: WSServer;

  beforeEach(() => {
    tempDir = mkTempDir();
    const config = createConfig(tempDir);
    db = new ClawDB(tempDir);
    wsServer = new WSServer(config, db);
  });

  afterEach(async () => {
    wsServer.close();
    await db.close();
  });

  it('getTokenStatus shows initial state (no grace period)', () => {
    const status = wsServer.getTokenStatus();
    expect(status.currentTokenMasked).toBe('initial-...');
    expect(status.inGracePeriod).toBe(false);
    expect(status.gracePeriodEnd).toBe(null);
  });

  it('rotateToken swaps token and starts grace period', () => {
    const newToken = 'rotated-token-xyz-12345';
    const result = wsServer.rotateToken(newToken, 5000);

    expect(result.oldToken).toBe('initial-token-abc');
    expect(result.newToken).toBe(newToken);
    expect(result.gracePeriodEnd).toBeGreaterThan(Date.now());
    expect(result.gracePeriodEnd).toBeLessThanOrEqual(Date.now() + 6000);

    const status = wsServer.getTokenStatus();
    expect(status.currentTokenMasked).toBe('rotated-...');
    expect(status.inGracePeriod).toBe(true);
    expect(status.gracePeriodEnd).toBe(result.gracePeriodEnd);
  });

  it('rotateToken uses default grace period from config', () => {
    const result = wsServer.rotateToken('token-b');
    expect(result.gracePeriodEnd).toBeGreaterThan(Date.now() + 2000);
    expect(result.gracePeriodEnd).toBeLessThanOrEqual(Date.now() + 3500);
  });

  it('rotateToken second time replaces previous token', () => {
    const r1 = wsServer.rotateToken('token-b', 10000);
    const r2 = wsServer.rotateToken('token-c', 20000);

    expect(r2.oldToken).toBe('token-b');
    expect(r2.newToken).toBe('token-c');
    expect(r2.gracePeriodEnd).toBeGreaterThan(r1.gracePeriodEnd);

    const status = wsServer.getTokenStatus();
    expect(status.currentTokenMasked).toBe('token-c...');
    expect(status.inGracePeriod).toBe(true);
  });

  it('rejects the old token after the grace period expires', async () => {
    const oldToken = 'initial-token-abc';
    const newToken = 'rotated-token-expiry';

    wsServer.rotateToken(newToken, 100);

    expect(wsServer.isTokenAuthorized(oldToken)).toBe(true);
    expect(wsServer.isTokenAuthorized(newToken)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(wsServer.isTokenAuthorized(oldToken)).toBe(false);
    expect(wsServer.isTokenAuthorized(newToken)).toBe(true);
  });
});
