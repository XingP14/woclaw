/**
 * R456 probe: is the memory half of the forgetting path reachable?
 *
 * Read from source first, then measured here:
 *   F1: setMemory INSERTs (key,value,tags,ttl,expire_at,updated_at,updated_by)
 *       — never importance_score / access_count / last_accessed_at — so a
 *       memory's stored importance stays at the column DEFAULT 5.0 forever.
 *   F2: importanceFloor defaults to 3.0, and the SELECT's HAVING is
 *       `importance < 3.0`. 5.0 < 3.0 is false, so the memory branch of
 *       getEvictionCandidates admits NOTHING.
 *   F3: the only lever that can move a memory below the floor is
 *       memory_feedback, reachable only via db.addMemoryFeedback — which
 *       has no production caller (rest_server routes session feedback only).
 *   F4: therefore the weekly job's `memoriesDeleted` counter is 0 in every
 *       deployment that has not wired feedback by hand.
 *
 * Also pinned, because they are the same defect read two ways:
 *   ForgettingConfig.minAccessCount and .recencyHalfLifeDays are declared and
 *   defaulted, and read by NOBODY — the ORDER BY hardcodes 0.3/0.2 weights
 *   over a hardcoded 90-day window.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClawDB } from '../src/db.js';
import { ForgettingScheduler } from '../src/scheduler.js';
import type { MemoryPool } from '../src/memory.js';

const FLOOR = 3.0; // DEFAULT_CONFIG.importanceFloor in scheduler.ts

describe('R456 — memory eviction reachability', () => {
  let dir: string;
  let db: ClawDB;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'r456-'));
    db = new ClawDB(dir);
    await new Promise(r => setTimeout(r, 50));
  });
  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('arm A: a written memory is not an eviction candidate at the production floor', async () => {
    await db.setMemory('k1', 'v1', 'agent-a');
    await db.setMemory('k2', 'v2', 'agent-b');
    const cand = await db.getEvictionCandidates(FLOOR, FLOOR, 50);
    // the finding: zero of them
    expect(cand.memories).toEqual([]);
  });

  it('arm B: the gate is LIVE, not dead SQL — a floor above 5.0 does admit them', async () => {
    // The control that stops arm A from passing vacuously (R421-1).
    // If the SELECT were broken, arm B would also return [].
    await db.setMemory('k1', 'v1', 'agent-a');
    await db.setMemory('k2', 'v2', 'agent-b');
    const wide = await db.getEvictionCandidates(99, FLOOR, 50);
    expect(wide.memories.map(m => m.key).sort()).toEqual(['k1', 'k2']);
    // and the scores are the column default, verbatim
    for (const m of wide.memories) expect(m.importance).toBe(5.0);
  });

  it('arm C: the floor is the whole story — 5.0 vs 3.0 — and it is the ONLY thing tested', async () => {
    await db.setMemory('k1', 'v1', 'agent-a');
    // a floor of exactly 5.0 admits it: 5.0 < 5.0 is false → still nothing
    expect((await db.getEvictionCandidates(5.0, FLOOR, 50)).memories).toEqual([]);
    // a floor of 5.0001 admits it
    const just = await db.getEvictionCandidates(5.0001, FLOOR, 50);
    expect(just.memories.map(m => m.key)).toEqual(['k1']);
  });

  it('arm D: negative memory_feedback is the only lever that arms the path', async () => {
    await db.setMemory('k1', 'v1', 'agent-a');
    await db.addMemoryFeedback('k1', 'agent-a', -5, 'never useful');
    const after = await db.getEvictionCandidates(FLOOR, FLOOR, 50);
    expect(after.memories.map(m => m.key)).toEqual(['k1']);
  });

  it('arm E: with feedback, the weekly run really does delete the row', async () => {
    await db.setMemory('k1', 'v1', 'agent-a');
    await db.addMemoryFeedback('k1', 'agent-a', -5, 'never useful');
    const sched = new ForgettingScheduler(db, null as never, null);
    const result = await sched.triggerEviction();
    expect(result.memories).toBe(1);
    expect(await db.getMemory('k1')).toBeUndefined();
  });

  it('arm F: WITHOUT feedback the same run deletes nothing — the counter reads 0', async () => {
    await db.setMemory('k1', 'v1', 'agent-a');
    await db.setMemory('k2', 'v2', 'agent-b');
    const sched = new ForgettingScheduler(db, null as never, null);
    const result = await sched.triggerEviction();
    // the weekly log line reads "memories=0" in every un-fed-back deployment
    expect(result.memories).toBe(0);
    expect(await db.getMemory('k1')).toBeDefined();
    expect(await db.getMemory('k2')).toBeDefined();
  });

  it('arm G: DBMemory declares importance fields that no read path projects', async () => {
    // getMemory's SELECT lists 7 columns and never the three importance ones.
    await db.setMemory('k1', 'v1', 'agent-a');
    const m = await db.getMemory('k1');
    expect(m).toBeDefined();
    expect(m!.importanceScore).toBeUndefined();
    expect(m!.accessCount).toBeUndefined();
    expect(m!.lastAccessedAt).toBeUndefined();
  });

  it('arm H: minAccessCount / recencyHalfLifeDays are declared, defaulted, and read by nobody', async () => {
    // Behavioral proof, not a text gate: configure them to values that would
    // be catastrophic if honoured, and observe that eviction is unchanged.
    await db.setMemory('k1', 'v1', 'agent-a');
    await db.addMemoryFeedback('k1', 'agent-a', -5, 'never useful');
    const sched = new ForgettingScheduler(db, null as never, null, {
      minAccessCount: 999,        // would forbid evicting anything
      recencyHalfLifeDays: 1,    // would forbid evicting anything old
    });
    const result = await sched.triggerEviction();
    // honoured → 0; ignored → 1. Measured, not asserted about.
    expect(result.memories).toBe(1);
  });
});
