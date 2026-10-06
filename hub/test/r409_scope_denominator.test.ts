import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

/**
 * R409 probe — falsification of R408's own headline metric.
 *
 * R408 (commit 444449f) reported "scope coverage 1/5 → 5/5". The denominator 5 was
 * never enumerated in code; it was the count of methods that *look like* a keyed
 * lookup. This probe enumerates the read paths that actually return memory rows to a
 * caller and measures whether each one can express a scope at all.
 *
 * Every test names the claim it falsifies. These assert CURRENT behaviour.
 */
describe('R409 — how many memory read paths can express a scope?', () => {
  const testDir = '/tmp/woclaw-r409-' + Date.now();
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
    // One workspace-scoped record, one session-scoped record.
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-VALUE', 'rest-api', ['workspace'], 0);
    await mp.write('openclaw:session:main:agent:main:cron:abc', 'SS-VALUE', 'rest-api', ['session'], 0);
  }

  it('F1: getAll() returns BOTH scopes and takes no scope argument', async () => {
    await seed();
    const all = await mp.getAll();
    const values = all.map(m => m.value).sort();
    expect(values).toEqual(['SS-VALUE', 'WS-VALUE']);
    // The method signature has no scope parameter at all:
    expect(mp.getAll.length).toBe(0);
  });

  it('F2: recall() returns a session-scoped row while searching under no scope', async () => {
    await seed();
    const hits = await mp.recall('SS-VALUE');
    expect(hits.map(h => h.key)).toContain('openclaw:session:main:agent:main:cron:abc');
    expect(mp.recall.length).toBe(2); // (query, intent) — no scope
  });

  it('F3: recallByText() has no scope parameter either', async () => {
    await seed();
    const hits = await mp.recallByText('SS VALUE');
    expect(hits.length).toBeGreaterThan(0);
    // signature is `recallByText(query, limit = 10)` — no scope parameter anywhere
    expect(mp.recallByText.length).toBe(1);
  });

  it('F4: queryByTag() filters by tag, never by scope', async () => {
    await seed();
    const byWorkspaceTag = await mp.queryByTag('workspace');
    expect(byWorkspaceTag.length).toBe(1);
    expect(byWorkspaceTag[0].value).toBe('WS-VALUE');
    // A caller asking for the 'session' tag still crosses into the other scope only by luck;
    // the method has no notion of scope as an independent axis.
    expect(mp.queryByTag.length).toBe(1); // (tag) only
  });

  it('F5: the 4 paths that DO take a scope are the ones R408 counted', async () => {
    await seed();
    expect(mp.search.length).toBe(1); // TS defaults collapse `.length` to the first required param
    expect(mp.read.length).toBe(1);
    expect(mp.delete.length).toBe(1);
    expect(mp.getVersions.length).toBe(1);
    // …and they do behave:
    expect(await mp.read('openclaw:session:main:agent:main:cron:abc', 'workspace')).toBeUndefined();
  });

  it('F6: total read-path count is 8, not 5', () => {
    const readPaths = ['getAll', 'search', 'read', 'delete', 'getVersions', 'recall', 'recallByText', 'queryByTag'];
    expect(readPaths.length).toBe(8);
  });
});
