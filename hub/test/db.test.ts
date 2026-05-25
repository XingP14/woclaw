import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

describe('ClawDB', () => {
  const testDir = '/tmp/woclaw-test-db-' + Date.now();
  let db: ClawDB;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Memory operations', () => {
    it('writes and reads a memory entry', async () => {
      await db.setMemory('project-name', 'my-app', 'agent1', [], 0);
      const mem = await db.getMemory('project-name');
      expect(mem).toBeDefined();
      expect(mem!.key).toBe('project-name');
      expect(mem!.value).toBe('my-app');
      expect(mem!.updatedBy).toBe('agent1');
    });

    it('stores tags correctly', async () => {
      await db.setMemory('key1', 'value1', 'agent1', ['project', 'important'], 0);
      const mem = await db.getMemory('key1');
      expect(mem!.tags).toContain('project');
      expect(mem!.tags).toContain('important');
      expect(mem!.tags.length).toBe(2);
    });

    it('handles TTL expiry correctly', async () => {
      await db.setMemory('temp', 'data', 'agent1', [], 1);
      const mem = await db.getMemory('temp');
      expect(mem).toBeDefined();

      await new Promise(resolve => setTimeout(resolve, 1100));
      const expired = await db.getMemory('temp');
      expect(expired).toBeUndefined();
    });

    it('updates existing memory entry and keeps version history', async () => {
      await db.setMemory('key1', 'value1', 'agent1', [], 0);
      await db.setMemory('key1', 'value2', 'agent2', [], 0);
      const mem = await db.getMemory('key1');
      expect(mem!.value).toBe('value2');
      expect(mem!.updatedBy).toBe('agent2');

      const versions = await db.getMemoryVersions('key1');
      expect(versions.length).toBe(1);
      expect(versions[0].value).toBe('value1');
      expect(versions[0].updatedBy).toBe('agent1');
    });

    it('deletes memory entry', async () => {
      await db.setMemory('key1', 'value1', 'agent1', [], 0);
      expect(await db.deleteMemory('key1')).toBe(true);
      expect(await db.getMemory('key1')).toBeUndefined();
    });

    it('deleteMemory returns false for non-existent key', async () => {
      expect(await db.deleteMemory('nonexistent')).toBe(false);
    });

    it('getAllMemory returns all entries', async () => {
      await db.setMemory('key1', 'val1', 'a', [], 0);
      await db.setMemory('key2', 'val2', 'b', [], 0);
      await db.setMemory('key3', 'val3', 'c', [], 0);
      const all = await db.getAllMemory();
      expect(all.length).toBe(3);
      expect(all.map(m => m.key).sort()).toEqual(['key1', 'key2', 'key3']);
    });

    it('getAllMemory excludes expired entries', async () => {
      await db.setMemory('valid', 'val', 'a', [], 0);
      await db.setMemory('expired', 'old', 'a', [], 1);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const all = await db.getAllMemory();
      expect(all.map(m => m.key)).toContain('valid');
      expect(all.map(m => m.key)).not.toContain('expired');
    });

    it('cleanupExpired removes expired entries', async () => {
      await db.setMemory('exp1', 'v', 'a', [], 1);
      await db.setMemory('exp2', 'v', 'a', [], 1);
      await db.setMemory('valid', 'v', 'a', [], 0);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const removed = await db.cleanupExpired();
      expect(removed).toBe(2);
      expect((await db.getAllMemory()).map(m => m.key)).toEqual(['valid']);
    });

    it('handles JSON values', async () => {
      const obj = { name: 'test', count: 42 };
      await db.setMemory('json-key', JSON.stringify(obj), 'agent1', [], 0);
      const mem = await db.getMemory('json-key');
      expect(JSON.parse(mem!.value)).toEqual(obj);
    });

    it('migrates legacy JSON memory entries', async () => {
      const legacyData = {
        messages: [],
        memory: [{ key: 'legacy', value: 'old', updatedBy: 'sys' }],
        memory_versions: [],
        topics: [],
      };
      writeFileSync(path.join(testDir, 'woclaw.json'), JSON.stringify(legacyData));

      await db.close();
      db = new ClawDB(testDir);

      const mem = await db.getMemory('legacy');
      expect(mem).toBeDefined();
      expect(mem!.tags).toEqual([]);
      expect(mem!.ttl).toBe(0);
      expect(mem!.updatedBy).toBe('sys');
    });
  });

  describe('Message operations', () => {
    it('saves and retrieves messages for a topic', async () => {
      await db.saveMessage({ id: 'm1', topic: 'general', from: 'agent1', content: 'hello', timestamp: Date.now() });
      await db.saveMessage({ id: 'm2', topic: 'general', from: 'agent2', content: 'hi', timestamp: Date.now() + 1 });
      const msgs = await db.getMessages('general', 10);
      expect(msgs.length).toBe(2);
      expect(msgs[0].content).toBe('hi');
    });

    it('getMessages respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await db.saveMessage({ id: `m${i}`, topic: 'general', from: 'a', content: `msg${i}`, timestamp: Date.now() + i });
      }
      const msgs = await db.getMessages('general', 3);
      expect(msgs.length).toBe(3);
    });

    it('getMessages returns empty for non-existent topic', async () => {
      expect(await db.getMessages('nonexistent')).toEqual([]);
    });

    it('getMessages filters by before timestamp', async () => {
      const now = Date.now();
      await db.saveMessage({ id: 'old', topic: 'general', from: 'a', content: 'old', timestamp: now - 100 });
      await db.saveMessage({ id: 'new', topic: 'general', from: 'a', content: 'new', timestamp: now + 100 });
      const msgs = await db.getMessages('general', 10, now);
      expect(msgs.length).toBe(1);
      expect(msgs[0].id).toBe('old');
    });
  });

  describe('Topic stats', () => {
    it('tracks message count per topic', async () => {
      await db.saveMessage({ id: 'm1', topic: 'general', from: 'a', content: 'msg', timestamp: Date.now() });
      await db.saveMessage({ id: 'm2', topic: 'general', from: 'a', content: 'msg', timestamp: Date.now() });
      await db.saveMessage({ id: 'm3', topic: 'dev', from: 'a', content: 'msg', timestamp: Date.now() });
      const stats = await db.getTopicStats();
      const general = stats.find(t => t.name === 'general');
      const dev = stats.find(t => t.name === 'dev');
      expect(general?.messageCount).toBe(2);
      expect(dev?.messageCount).toBe(1);
    });
  });

  describe('Persistence', () => {
    it('persists data to disk', async () => {
      await db.setMemory('persist-key', 'persist-value', 'agent1', ['test'], 0);
      await db.saveMessage({ id: 'm1', topic: 'general', from: 'a', content: 'msg', timestamp: Date.now() });
      await db.close();

      const db2 = new ClawDB(testDir);
      expect((await db2.getMemory('persist-key'))!.value).toBe('persist-value');
      expect((await db2.getMessages('general')).length).toBe(1);
      await db2.close();
    });
  });

  describe('Memory Encryption at Rest', () => {
    it('encrypts and decrypts memory values when encryption is enabled', async () => {
      const encDir = '/tmp/woclaw-test-enc-' + Date.now();
      mkdirSync(encDir, { recursive: true });
      const encDb = new ClawDB({
        port: 0,
        restPort: 0,
        host: '127.0.0.1',
        dataDir: encDir,
        authToken: '',
        encryption: { enabled: true, passphrase: 'test-passphrase-123' },
      });

      await encDb.setMemory('secret', 'my-secret-value', 'agent1', [], 0);
      const mem = await encDb.getMemory('secret');
      expect(mem).toBeDefined();
      expect(mem!.value).toBe('my-secret-value');

      // Verify raw DB value is encrypted (not plaintext)
      const Database = (await import('better-sqlite3')).default;
      const rawDb = new Database(require('path').join(encDir, 'woclaw.sqlite'));
      const raw = rawDb.prepare('SELECT value FROM memory WHERE key = ?').get('secret') as any;
      expect(raw.value).toContain('ENC:v1:');
      expect(raw.value).not.toBe('my-secret-value');
      rawDb.close();

      await encDb.close();
      rmSync(encDir, { recursive: true, force: true });
    });

    it('stores plaintext when encryption is disabled', async () => {
      await db.setMemory('plain', 'plain-value', 'agent1', [], 0);
      const mem = await db.getMemory('plain');
      expect(mem!.value).toBe('plain-value');
    });

    it('decrypts version history correctly', async () => {
      const encDir = '/tmp/woclaw-test-enc-ver-' + Date.now();
      mkdirSync(encDir, { recursive: true });
      const encDb = new ClawDB({
        port: 0,
        restPort: 0,
        host: '127.0.0.1',
        dataDir: encDir,
        authToken: '',
        encryption: { enabled: true, passphrase: 'test-passphrase-123' },
      });

      await encDb.setMemory('versioned', 'v1', 'agent1', [], 0);
      await encDb.setMemory('versioned', 'v2', 'agent2', [], 0);

      const current = await encDb.getMemory('versioned');
      expect(current!.value).toBe('v2');

      const versions = await encDb.getMemoryVersions('versioned');
      expect(versions.length).toBe(1);
      expect(versions[0].value).toBe('v1');

      await encDb.close();
      rmSync(encDir, { recursive: true, force: true });
    });

    it('decrypts getAllMemory results', async () => {
      const encDir = '/tmp/woclaw-test-enc-all-' + Date.now();
      mkdirSync(encDir, { recursive: true });
      const encDb = new ClawDB({
        port: 0,
        restPort: 0,
        host: '127.0.0.1',
        dataDir: encDir,
        authToken: '',
        encryption: { enabled: true, passphrase: 'test-passphrase-123' },
      });

      await encDb.setMemory('k1', 'secret1', 'agent1', [], 0);
      await encDb.setMemory('k2', 'secret2', 'agent2', [], 0);

      const all = await encDb.getAllMemory();
      expect(all.length).toBe(2);
      expect(all.find(m => m.key === 'k1')!.value).toBe('secret1');
      expect(all.find(m => m.key === 'k2')!.value).toBe('secret2');

      await encDb.close();
      rmSync(encDir, { recursive: true, force: true });
    });
  });
});
