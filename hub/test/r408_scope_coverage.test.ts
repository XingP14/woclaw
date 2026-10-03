import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

/**
 * R408 — scope coverage on every memory access path.
 *
 * R407 measured that `scope` was a parameter of exactly one of five memory access
 * paths (`search`). `read`, `delete` and `getVersions` had no way to express a
 * scope at all, so a caller who knew a key bypassed the filter entirely via
 * `GET /memory/<key>`.
 *
 * Each test asserts that a record outside the requested scope is *not* resolvable by
 * direct key lookup. These were written before the fix (RED: 3 of 6 failed) and now
 * pin the behaviour: direct lookup cannot bypass a scope filter.
 */
describe('R408 — scope guard on read/delete/getVersions (not just search)', () => {
  const testDir = '/tmp/woclaw-r408-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
    mp = new MemoryPool(db);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function seed(): Promise<void> {
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS', 'rest-api', ['infra'], 0);
    await mp.write('openclaw:session:main:agent:main:cron:abc', 'SS', 'rest-api', ['session'], 0);
  }

  it('read() does not resolve a session-scoped key under the workspace scope', async () => {
    await seed();
    expect(await mp.read('openclaw:session:main:agent:main:cron:abc', 'workspace')).toBeUndefined();
  });

  it('read() still resolves the key under a scope that contains it', async () => {
    await seed();
    expect((await mp.read('openclaw:workspace:infra:ssh-key', 'workspace'))?.value).toBe('WS');
  });

  it('read() defaults to "all" so existing callers are unaffected', async () => {
    await seed();
    expect((await mp.read('openclaw:session:main:agent:main:cron:abc'))?.value).toBe('SS');
  });

  it('delete() refuses a key outside the requested scope and leaves it intact', async () => {
    await seed();
    expect(await mp.delete('openclaw:session:main:agent:main:cron:abc', 'workspace')).toBe(false);
    expect((await mp.getAll()).some(m => m.key.includes('session:'))).toBe(true);
  });

  it('getVersions() does not disclose history for a key outside the scope', async () => {
    await seed();
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-v2', 'rest-api', ['infra'], 0);
    expect(await mp.getVersions('openclaw:session:main:agent:main:cron:abc', 'workspace')).toEqual([]);
    expect((await mp.getVersions('openclaw:workspace:infra:ssh-key', 'workspace')).length).toBeGreaterThan(0);
  });

  it('a read and a scoped search agree on visibility (no search-vs-read bypass)', async () => {
    await seed();
    const scoped = (await mp.search('openclaw', 10, 'workspace')).map(m => m.key);
    const readable = await mp.read('openclaw:session:main:agent:main:cron:abc', 'workspace');
    expect(scoped).not.toContain('openclaw:session:main:agent:main:cron:abc');
    expect(readable).toBeUndefined();
  });
});
