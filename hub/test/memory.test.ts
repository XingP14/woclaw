import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { existsSync, rmSync } from 'fs';

describe('MemoryPool', () => {
  const testDir = '/tmp/woclaw-test-memory-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;

  beforeEach(() => {
    db = new ClawDB(testDir);
    mp = new MemoryPool(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('write / read', () => {
    it('writes and reads memory', () => {
      mp.write('project-name', 'my-app', 'agent1');
      const mem = mp.read('project-name');
      expect(mem?.value).toBe('my-app');
      expect(mem?.updatedBy).toBe('agent1');
    });

    it('writes with tags', () => {
      mp.write('key1', 'val1', 'agent1', ['project', 'important']);
      const mem = mp.read('key1');
      expect(mem?.tags).toContain('project');
      expect(mem?.tags).toContain('important');
    });

    it('writes with TTL', () => {
      mp.write('temp', 'data', 'agent1', [], 3600);
      const mem = mp.read('temp');
      expect(mem?.ttl).toBe(3600);
      expect(mem?.expireAt).toBeGreaterThan(Date.now());
    });

    it('returns undefined for non-existent key', () => {
      expect(mp.read('nonexistent')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes memory entry', () => {
      mp.write('key1', 'val1', 'agent1');
      expect(mp.delete('key1')).toBe(true);
      expect(mp.read('key1')).toBeUndefined();
    });

    it('returns false when deleting non-existent key', () => {
      expect(mp.delete('nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all memory entries', () => {
      mp.write('key1', 'val1', 'a');
      mp.write('key2', 'val2', 'b');
      mp.write('key3', 'val3', 'c');
      const all = mp.getAll();
      expect(all.length).toBe(3);
    });
  });

  describe('queryByTag', () => {
    it('queries memory by tag', () => {
      mp.write('key1', 'val1', 'a', ['project']);
      mp.write('key2', 'val2', 'b', ['research']);
      mp.write('key3', 'val3', 'c', ['project', 'important']);
      const project = mp.queryByTag('project');
      expect(project.length).toBe(2);
      expect(project.map(m => m.key)).toContain('key1');
      expect(project.map(m => m.key)).toContain('key3');
    });

    it('returns empty array for non-existent tag', () => {
      mp.write('key1', 'val1', 'a', ['project']);
      expect(mp.queryByTag('nonexistent')).toEqual([]);
    });
  });

  describe('cleanupExpired', () => {
    it('removes expired entries', () => {
      // Create expired entry directly in DB
      const now = Date.now();
      (db as any).data.memory.push({ key: 'expired', value: 'v', tags: [], ttl: 1, expireAt: now - 1000, updatedAt: now, updatedBy: 'a' });
      mp.write('valid', 'v', 'a', [], 0);
      const removed = mp.cleanupExpired();
      expect(removed).toBe(1);
      expect(mp.getAll().map(m => m.key)).toEqual(['valid']);
    });
  });

  describe('subscriber notifications', () => {
    it('notifies subscribers on memory write', () => {
      const notifications: any[] = [];
      mp.subscribe('agent1', (msg) => notifications.push(msg));
      mp.write('key1', 'val1', 'agent1', [], 0);
      mp.unsubscribe('agent1');
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe('memory_write');
    });

    it('unsubscribe stops notifications', () => {
      const notifications: any[] = [];
      mp.subscribe('agent1', (msg) => notifications.push(msg));
      mp.unsubscribe('agent1');
      mp.write('key1', 'val1', 'agent1');
      expect(notifications.length).toBe(0);
    });
  });
});
