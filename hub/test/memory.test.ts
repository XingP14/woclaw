import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

describe('MemoryPool', () => {
  const testDir = '/tmp/woclaw-test-memory-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
    mp = new MemoryPool(db);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('write / read', () => {
    it('writes and reads memory', async () => {
      await mp.write('project-name', 'my-app', 'agent1');
      const mem = await mp.read('project-name');
      expect(mem?.value).toBe('my-app');
      expect(mem?.updatedBy).toBe('agent1');
    });

    it('writes with tags', async () => {
      await mp.write('key1', 'val1', 'agent1', ['project', 'important']);
      const mem = await mp.read('key1');
      expect(mem?.tags).toContain('project');
      expect(mem?.tags).toContain('important');
    });

    it('writes with TTL', async () => {
      await mp.write('temp', 'data', 'agent1', [], 3600);
      const mem = await mp.read('temp');
      expect(mem?.ttl).toBe(3600);
      expect(mem?.expireAt).toBeGreaterThan(Date.now());
    });

    it('returns undefined for non-existent key', async () => {
      expect(await mp.read('nonexistent')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes memory entry', async () => {
      await mp.write('key1', 'val1', 'agent1');
      expect(await mp.delete('key1')).toBe(true);
      expect(await mp.read('key1')).toBeUndefined();
    });

    it('returns false when deleting non-existent key', async () => {
      expect(await mp.delete('nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all memory entries', async () => {
      await mp.write('key1', 'val1', 'a');
      await mp.write('key2', 'val2', 'b');
      await mp.write('key3', 'val3', 'c');
      const all = await mp.getAll();
      expect(all.length).toBe(3);
    });
  });

  describe('queryByTag', () => {
    it('queries memory by tag', async () => {
      await mp.write('key1', 'val1', 'a', ['project']);
      await mp.write('key2', 'val2', 'b', ['research']);
      await mp.write('key3', 'val3', 'c', ['project', 'important']);
      const project = await mp.queryByTag('project');
      expect(project.length).toBe(2);
      expect(project.map(m => m.key)).toContain('key1');
      expect(project.map(m => m.key)).toContain('key3');
    });

    it('returns empty array for non-existent tag', async () => {
      await mp.write('key1', 'val1', 'a', ['project']);
      expect(await mp.queryByTag('nonexistent')).toEqual([]);
    });
  });

  describe('Precise Search', () => {
    it('matches key and title, not body noise', async () => {
      await mp.write(
        'openclaw:workspace:workspace:memory:2026-03-07-vps-firewall.md',
        '# OpenClaw Workspace Memory\nSome unrelated body text about notes.',
        'a',
        ['openclaw', 'workspace-memory'],
      );
      await mp.write(
        'openclaw:session:main:agent:main:cron:abc123',
        '# OpenClaw Session Store\nFirewall is mentioned only in the body.',
        'a',
        ['openclaw', 'session-store'],
      );

      const results = await mp.search('firewall');
      expect(results.length).toBe(1);
      expect(results[0].key).toContain('vps-firewall');
    });

    it('supports workspace and session scope filters', async () => {
      await mp.write(
        'openclaw:workspace:workspace:memory:2026-03-01.md',
        '# OpenClaw Workspace Memory\nAlpha',
        'a',
        ['openclaw', 'workspace-memory'],
      );
      await mp.write(
        'openclaw:session:main:agent:main:cron:abc123',
        '# OpenClaw Session Store\nAlpha',
        'a',
        ['openclaw', 'session-store'],
      );

      const workspaceResults = await mp.search('openclaw', 10, 'workspace');
      expect(workspaceResults.length).toBe(1);
      expect(workspaceResults[0].key).toContain('workspace:memory');

      const sessionResults = await mp.search('openclaw', 10, 'session');
      expect(sessionResults.length).toBe(1);
      expect(sessionResults[0].key).toContain('session:main');
    });
  });

  describe('cleanupExpired', () => {
    it('removes expired entries', async () => {
      await mp.write('expired', 'v', 'a', [], 1);
      await mp.write('valid', 'v', 'a', [], 0);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const removed = await mp.cleanupExpired();
      expect(removed).toBe(1);
      expect((await mp.getAll()).map(m => m.key)).toEqual(['valid']);
    });
  });

  describe('subscriber notifications', () => {
    it('notifies subscribers on memory write', async () => {
      const notifications: any[] = [];
      mp.subscribe('agent1', (msg) => notifications.push(msg));
      await mp.write('key1', 'val1', 'agent1', [], 0);
      mp.unsubscribe('agent1');
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe('memory_write');
    });

    it('unsubscribe stops notifications', async () => {
      const notifications: any[] = [];
      mp.subscribe('agent1', (msg) => notifications.push(msg));
      mp.unsubscribe('agent1');
      await mp.write('key1', 'val1', 'agent1');
      expect(notifications.length).toBe(0);
    });
  });

  describe('Semantic Recall (v0.4)', () => {
    it('returns empty for stop-word-only query', async () => {
      await mp.write('key1', 'the quick brown fox jumps', 'a');
      expect((await mp.recall('the is a')).length).toBe(0);
    });

    it('returns matching entries for keyword query', async () => {
      await mp.write('proj', 'my awesome project', 'a', ['project']);
      await mp.write('other', 'something else', 'b');
      const results = await mp.recall('awesome project');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBe('proj');
    });

    it('boosts tag matches over value-only matches', async () => {
      await mp.write('a', 'nodejs code', 'a', ['backend']);
      await mp.write('b', 'backend server setup', 'b', []);
      const results = await mp.recall('backend');
      expect(results[0].key).toBe('a');
    });

    it('applies intent filter to boost related tags', async () => {
      await mp.write('a', 'deploy script', 'a', ['devops']);
      await mp.write('b', 'deploy docker container', 'b', ['devops', 'docker']);
      const results = await mp.recall('deploy', 'docker');
      expect(results[0].key).toBe('b');
    });

    it('respects limit parameter', async () => {
      await mp.write('k1', 'apple fruit', 'a');
      await mp.write('k2', 'banana fruit', 'a');
      await mp.write('k3', 'cherry fruit', 'a');
      await mp.write('k4', 'date fruit', 'a');
      await mp.write('k5', 'elderberry', 'a');
      const results = await mp.recall('fruit', undefined, 3);
      expect(results.length).toBe(3);
    });

    it('returns empty for non-matching query', async () => {
      await mp.write('key1', 'nodejs server', 'a');
      expect((await mp.recall('python django flask elasticsearch')).length).toBe(0);
    });
  });

  describe('Memory Versioning (v0.4)', () => {
    it('getVersions returns empty array for new key', async () => {
      await mp.write('key1', 'val1', 'agent1');
      expect(await mp.getVersions('key1')).toEqual([]);
    });

    it('getVersions returns versions when key is updated', async () => {
      await mp.write('key1', 'val1', 'agent1');
      await mp.write('key1', 'val2', 'agent2');
      const versions = await mp.getVersions('key1');
      expect(versions.length).toBe(1);
      expect(versions[0].value).toBe('val1');
      expect(versions[0].version).toBe(1);
      expect(versions[0].updatedBy).toBe('agent1');
    });

    it('getVersions returns multiple versions in descending order', async () => {
      await mp.write('key1', 'v1', 'a1', ['tag1'], 100);
      await mp.write('key1', 'v2', 'a2', ['tag2'], 200);
      await mp.write('key1', 'v3', 'a3', ['tag3'], 300);
      const versions = await mp.getVersions('key1');
      expect(versions.length).toBe(2);
      expect(versions[0].value).toBe('v2');
      expect(versions[0].version).toBe(2);
      expect(versions[0].tags).toEqual(['tag2']);
      expect(versions[0].ttl).toBe(200);
      expect(versions[1].value).toBe('v1');
      expect(versions[1].version).toBe(1);
      expect(versions[1].tags).toEqual(['tag1']);
      expect(versions[1].ttl).toBe(100);
    });

    it('current value is preserved, only old values in versions', async () => {
      await mp.write('key1', 'current', 'agent1');
      await mp.write('key1', 'old', 'agent2');
      const mem = await mp.read('key1');
      expect(mem?.value).toBe('old');
      expect(mem?.updatedBy).toBe('agent2');
      const versions = await mp.getVersions('key1');
      expect(versions.length).toBe(1);
      expect(versions[0].value).toBe('current');
    });

    it('getVersions returns empty for non-existent key', async () => {
      expect(await mp.getVersions('nonexistent')).toEqual([]);
    });

    it('getVersions does not affect other keys', async () => {
      await mp.write('key1', 'val1', 'a1');
      await mp.write('key1', 'val2', 'a2');
      await mp.write('key2', 'other', 'a1');
      const v1 = await mp.getVersions('key1');
      const v2 = await mp.getVersions('key2');
      expect(v1.length).toBe(1);
      expect(v2.length).toBe(0);
    });
  });
});
