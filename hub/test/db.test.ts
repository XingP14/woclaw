import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { existsSync, rmSync } from 'fs';
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

    it('handles TTL expiry correctly', () => {
      // Set TTL to 1 second
      db.setMemory('temp', 'data', 'agent1', [], 1);
      const mem = db.getMemory('temp');
      expect(mem).toBeDefined(); // Not expired yet

      // Force expire by setting TTL to -1 (already expired)
      db.setMemory('temp', 'data', 'agent1', [], -1);
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
      db.setMemory('expired', 'val', 'a', [], -1); // Already expired
      const all = db.getAllMemory();
      expect(all.map(m => m.key)).toContain('valid');
      expect(all.map(m => m.key)).not.toContain('expired');
    });

    it('cleanupExpired removes expired entries', () => {
      db.setMemory('exp1', 'v', 'a', [], -1);
      db.setMemory('exp2', 'v', 'a', [], -1);
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
      // Directly manipulate data to simulate legacy entry
      (db as any).data.memory.push({ key: 'legacy', value: 'old', updatedBy: 'sys' });
      const mem = db.getMemory('legacy');
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
