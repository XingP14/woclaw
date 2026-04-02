import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

describe('ClawDB', () => {
  const testDir = '/tmp/woclaw-test-db-' + Date.now();
  let db: ClawDB;

  beforeEach(() => {
    db = new ClawDB(testDir);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Memory operations', () => {
    it('writes and reads a memory entry', () => {
      db.setMemory('project-name', 'my-app', 'agent1', [], 0);
      const mem = db.getMemory('project-name');
      expect(mem).toBeDefined();
      expect(mem!.key).toBe('project-name');
      expect(mem!.value).toBe('my-app');
      expect(mem!.updatedBy).toBe('agent1');
    });

    it('stores tags correctly', () => {
      db.setMemory('key1', 'value1', 'agent1', ['project', 'important'], 0);
      const mem = db.getMemory('key1');
      expect(mem!.tags).toContain('project');
      expect(mem!.tags).toContain('important');
      expect(mem!.tags.length).toBe(2);
    });

    it('handles TTL expiry correctly', async () => {
      // Set TTL to 1 second and wait for expiry
      db.setMemory('temp', 'data', 'agent1', [], 1);
      const mem = db.getMemory('temp');
      expect(mem).toBeDefined(); // Not expired yet

      // Force expire by setting expireAt to past
      const entry = (db as any).data.memory.find((m: any) => m.key === 'temp');
      entry.expireAt = Date.now() - 1000; // Already expired
      const expired = db.getMemory('temp');
      expect(expired).toBeUndefined();
    });

    it('updates existing memory entry', () => {
      db.setMemory('key1', 'value1', 'agent1', [], 0);
      db.setMemory('key1', 'value2', 'agent2', [], 0);
      const mem = db.getMemory('key1');
      expect(mem!.value).toBe('value2');
      expect(mem!.updatedBy).toBe('agent2');
    });

    it('deletes memory entry', () => {
      db.setMemory('key1', 'value1', 'agent1', [], 0);
      expect(db.deleteMemory('key1')).toBe(true);
      expect(db.getMemory('key1')).toBeUndefined();
    });

    it('deleteMemory returns false for non-existent key', () => {
      expect(db.deleteMemory('nonexistent')).toBe(false);
    });

    it('getAllMemory returns all entries', () => {
      db.setMemory('key1', 'val1', 'a', [], 0);
      db.setMemory('key2', 'val2', 'b', [], 0);
      db.setMemory('key3', 'val3', 'c', [], 0);
      const all = db.getAllMemory();
      expect(all.length).toBe(3);
      expect(all.map(m => m.key).sort()).toEqual(['key1', 'key2', 'key3']);
    });

    it('getAllMemory excludes expired entries', () => {
      db.setMemory('valid', 'val', 'a', [], 0);
      // Create an expired entry directly
      (db as any).data.memory.push({ key: 'expired', value: 'old', tags: [], ttl: 1, expireAt: Date.now() - 1000, updatedAt: Date.now(), updatedBy: 'a' });
      const all = db.getAllMemory();
      expect(all.map(m => m.key)).toContain('valid');
      expect(all.map(m => m.key)).not.toContain('expired');
    });

    it('cleanupExpired removes expired entries', () => {
      // Create already-expired entries directly
      const now = Date.now();
      (db as any).data.memory.push({ key: 'exp1', value: 'v', tags: [], ttl: 1, expireAt: now - 1000, updatedAt: now, updatedBy: 'a' });
      (db as any).data.memory.push({ key: 'exp2', value: 'v', tags: [], ttl: 1, expireAt: now - 1000, updatedAt: now, updatedBy: 'a' });
      db.setMemory('valid', 'v', 'a', [], 0);
      const removed = db.cleanupExpired();
      expect(removed).toBe(2);
      expect(db.getAllMemory().map(m => m.key)).toEqual(['valid']);
    });

    it('handles JSON values', () => {
      const obj = { name: 'test', count: 42 };
      db.setMemory('json-key', JSON.stringify(obj), 'agent1', [], 0);
      const mem = db.getMemory('json-key');
      expect(JSON.parse(mem!.value)).toEqual(obj);
    });

    it('migrates legacy memory entries without tags/ttl', () => {
      // Write legacy data directly to the DB file (simulating pre-v0.4 data)
      const legacyData = {
        messages: [],
        memory: [{ key: 'legacy', value: 'old', updatedBy: 'sys' }], // missing tags, ttl, expireAt
        topics: [],
      };
      const dbPath = (db as any).dbPath;
      writeFileSync(dbPath, JSON.stringify(legacyData));
      console.log('dbPath:', dbPath);
      console.log('Before load - memory:', JSON.stringify((db as any).data.memory));
      // Re-call load() to trigger migration
      (db as any).load();
      console.log('After load - memory:', JSON.stringify((db as any).data.memory));
      const mem = db.getMemory('legacy');
      console.log('mem:', mem);
      expect(mem).toBeDefined();
      expect(mem!.tags).toEqual([]);
      expect(mem!.ttl).toBe(0);
    });
  });

  describe('Message operations', () => {
    it('saves and retrieves messages for a topic', () => {
      db.saveMessage({ id: 'm1', topic: 'general', from: 'agent1', content: 'hello', timestamp: Date.now() });
      db.saveMessage({ id: 'm2', topic: 'general', from: 'agent2', content: 'hi', timestamp: Date.now() + 1 });
      const msgs = db.getMessages('general', 10);
      expect(msgs.length).toBe(2);
      // Most recent first
      expect(msgs[0].content).toBe('hi');
    });

    it('getMessages respects limit', () => {
      for (let i = 0; i < 10; i++) {
        db.saveMessage({ id: `m${i}`, topic: 'general', from: 'a', content: `msg${i}`, timestamp: Date.now() + i });
      }
      const msgs = db.getMessages('general', 3);
      expect(msgs.length).toBe(3);
    });

    it('getMessages returns empty for non-existent topic', () => {
      expect(db.getMessages('nonexistent')).toEqual([]);
    });

    it('getMessages filters by before timestamp', () => {
      const now = Date.now();
      db.saveMessage({ id: 'old', topic: 'general', from: 'a', content: 'old', timestamp: now - 100 });
      db.saveMessage({ id: 'new', topic: 'general', from: 'a', content: 'new', timestamp: now + 100 });
      const msgs = db.getMessages('general', 10, now);
      expect(msgs.length).toBe(1);
      expect(msgs[0].id).toBe('old');
    });
  });

  describe('Topic stats', () => {
    it('tracks message count per topic', () => {
      db.saveMessage({ id: 'm1', topic: 'general', from: 'a', content: 'msg', timestamp: Date.now() });
      db.saveMessage({ id: 'm2', topic: 'general', from: 'a', content: 'msg', timestamp: Date.now() });
      db.saveMessage({ id: 'm3', topic: 'dev', from: 'a', content: 'msg', timestamp: Date.now() });
      const stats = db.getTopicStats();
      const general = stats.find(t => t.name === 'general');
      const dev = stats.find(t => t.name === 'dev');
      expect(general?.messageCount).toBe(2);
      expect(dev?.messageCount).toBe(1);
    });
  });

  describe('Persistence', () => {
    it('persists data to disk', () => {
      db.setMemory('persist-key', 'persist-value', 'agent1', ['test'], 0);
      db.saveMessage({ id: 'm1', topic: 'general', from: 'a', content: 'msg', timestamp: Date.now() });
      db.close();

      // Reopen DB
      const db2 = new ClawDB(testDir);
      expect(db2.getMemory('persist-key')!.value).toBe('persist-value');
      expect(db2.getMessages('general').length).toBe(1);
      db2.close();
    });
  });
});
