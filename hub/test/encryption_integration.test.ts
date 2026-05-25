import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Config } from '../src/types.js';

describe('ClawDB Encryption at Rest', () => {
  const testDir = '/tmp/woclaw-test-encryption-' + Date.now();
  const passphrase = 'test-passphrase-encryption-2026';
  let db: ClawDB;
  let mp: MemoryPool;

  function makeConfig(overrides?: Partial<Config>): Config {
    return {
      port: 8082,
      restPort: 8083,
      host: 'localhost',
      dataDir: testDir,
      authToken: 'test-token',
      encryption: { enabled: true, passphrase },
      ...overrides,
    };
  }

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (db) await db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('with encryption enabled', () => {
    beforeEach(() => {
      db = new ClawDB(makeConfig());
      mp = new MemoryPool(db);
    });

    it('encrypts value on write and decrypts on read', async () => {
      await mp.write('secret-key', 'sensitive-data', 'agent1');
      const mem = await mp.read('secret-key');
      expect(mem?.value).toBe('sensitive-data');
    });

    it('stores encrypted ciphertext in SQLite (not plaintext)', async () => {
      await mp.write('raw-check', 'plaintext-value', 'agent1');
      // Read raw SQLite to verify encryption
      const dbPath = join(testDir, 'woclaw.sqlite');
      // Force close to read raw file
      await db.close();
      db = null as any;

      // Use better-sqlite3 directly to check raw value
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      const rawDb = new Database(dbPath);
      const row = rawDb.prepare('SELECT value FROM memory WHERE key = ?').get('raw-check') as any;
      rawDb.close();

      // Raw value should NOT be plaintext
      expect(row.value).not.toBe('plaintext-value');
      // Should be encrypted payload (contains ENC:v1: prefix or ciphertext)
      expect(row.value.length).toBeGreaterThan(0);
    });

    it('handles special characters and unicode', async () => {
      const unicode = '你好世界 🌍 émojis & <script>special</script>';
      await mp.write('unicode-key', unicode, 'agent1');
      const mem = await mp.read('unicode-key');
      expect(mem?.value).toBe(unicode);
    });

    it('handles empty string value', async () => {
      await mp.write('empty-key', '', 'agent1');
      const mem = await mp.read('empty-key');
      expect(mem?.value).toBe('');
    });

    it('handles large values', async () => {
      const large = 'x'.repeat(100_000);
      await mp.write('large-key', large, 'agent1');
      const mem = await mp.read('large-key');
      expect(mem?.value).toBe(large);
    });

    it('overwrites with re-encryption', async () => {
      await mp.write('overwrite-key', 'original', 'agent1');
      await mp.write('overwrite-key', 'updated', 'agent2');
      const mem = await mp.read('overwrite-key');
      expect(mem?.value).toBe('updated');
      expect(mem?.updatedBy).toBe('agent2');
    });

    it('decrypts versions correctly', async () => {
      await mp.write('version-key', 'v1', 'agent1');
      await mp.write('version-key', 'v2', 'agent1');
      const versions = await db.getMemoryVersions('version-key');
      expect(versions.length).toBe(1);
      expect(versions[0].value).toBe('v1');
    });

    it('recall returns decrypted values', async () => {
      await mp.write('recall-enc', 'project: WoClaw encryption test', 'agent1', ['crypto']);
      const results = await mp.recall('WoClaw');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].value).toContain('WoClaw encryption test');
    });
  });

  describe('without encryption (disabled)', () => {
    beforeEach(() => {
      db = new ClawDB(makeConfig({ encryption: { enabled: false } }));
      mp = new MemoryPool(db);
    });

    it('stores plaintext when encryption disabled', async () => {
      await mp.write('plain-key', 'plain-value', 'agent1');
      const mem = await mp.read('plain-key');
      expect(mem?.value).toBe('plain-value');

      // Raw SQLite should contain plaintext
      const dbPath = join(testDir, 'woclaw.sqlite');
      await db.close();
      db = null as any;

      const Database = require('better-sqlite3');
      const rawDb = new Database(dbPath);
      const row = rawDb.prepare('SELECT value FROM memory WHERE key = ?').get('plain-key') as any;
      rawDb.close();

      expect(row.value).toBe('plain-value');
    });
  });

  describe('encryption toggle', () => {
    it('can read old plaintext when encryption is later enabled', async () => {
      // Write without encryption
      db = new ClawDB(makeConfig({ encryption: { enabled: false } }));
      mp = new MemoryPool(db);
      await mp.write('toggle-key', 'toggle-value', 'agent1');
      await db.close();

      // Reopen with encryption enabled
      db = new ClawDB(makeConfig({ encryption: { enabled: true, passphrase } }));
      mp = new MemoryPool(db);
      const mem = await mp.read('toggle-key');
      // Should still read (plaintext passes through isEncrypted check)
      expect(mem?.value).toBe('toggle-value');
    });
  });
});
