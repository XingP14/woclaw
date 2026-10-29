/**
 * R517 probe -- does a session's feedback adjustment ever change its
 * eviction score?
 *
 * CLAIM (from source reading, now MEASURED):
 *   `session_feedback.adjustment` is WRITTEN by `addSessionFeedback`
 *   (product-reachable: src/session_store.ts:157 calls it), but the
 *   eviction query for SESSIONS never joins it:
 *
 *     SELECT id, importance, ... FROM sessions WHERE importance < ?
 *
 *   while the eviction query for MEMORIES does:
 *
 *     ... + COALESCE(SUM(f.adjustment), 0) AS importance
 *     FROM memory m LEFT JOIN memory_feedback f ON m.key = f.key
 *
 *   So the session feedback a user records is stored, and read back only by
 *   `getSessionFeedbackHistory` (which the PRODUCT never calls), and never
 *   influences the importance used to decide what to forget.
 *
 * THE MEASUREMENT:
 *   1. create a session with importance 5.0
 *   2. record a feedback adjustment of -5.0 for it
 *   3. ask for the eviction candidates with a threshold of 4.9
 *      -> if the adjustment counted, the session's effective importance
 *         would be 0.0 and it WOULD appear as a candidate
 *      -> if it does not count, the effective importance stays 5.0 and the
 *         session does NOT appear
 *
 *   Then the same probe for MEMORY, which must APPEAR -- that is the
 *   control arm: it proves the probe can see an adjustment that DOES count.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClawDB } from '../src/db.js';

describe('R517 -- session_feedback adjustment vs the eviction score', () => {
  let dir: string;
  let db: ClawDB;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'r517-'));
    db = new ClawDB({ dataDir: dir } as never);
    await (db as never as { ready: Promise<void> }).ready;
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: a memory adjustment DOES change the eviction score', async () => {
    await db.setMemory('r517-mem', 'a memory worth keeping', 'agent-a');
    // find the memory's current importance via the eviction query itself
    const before = await db.getEvictionCandidates(99, -1, 50);
    const memBefore = before.memories.find(m => m.key === 'r517-mem');
    const impBefore = memBefore?.importance;

    await db.addMemoryFeedback('r517-mem', 'agent-a', -5, 'never useful');
    const after = await db.getEvictionCandidates(99, -1, 50);
    const memAfter = after.memories.find(m => m.key === 'r517-mem');

    expect(impBefore).toBeDefined();
    expect(memAfter).toBeDefined();
    // the adjustment must have moved the score down by 5
    expect(memAfter!.importance).toBeLessThan(memBefore!.importance);
  });

  it('FINDING: a session adjustment does NOT change the eviction score', async () => {
    await db.setSession({
      id: 'r517-sess',
      agentId: 'agent-a',
      framework: 'test',
      startedAt: Date.now(),
      transcript: 'a session worth keeping',
      summary: '',
      importance: 5.0,
      accessCount: 0,
      lastAccessedAt: undefined,
      tags: [],
      extracted: false,
      flagged: false,
      createdAt: Date.now(),
    } as never);

    // the adjustment IS recorded -- the write path works
    await db.addSessionFeedback('r517-sess', 'agent-a', -5, 'never useful');
    const hist = await db.getSessionFeedbackHistory('r517-sess');
    expect(hist.length).toBe(1);
    expect(hist[0].adjustment).toBe(-5);

    // NEGATIVE-CONTROL ARM: the session MUST be a candidate when the
    // threshold is above its stored importance.  Without this, "not a
    // candidate" could mean "the query never returns sessions at all" --
    // a vacuous green (R505-3: a control that cannot fail).
    const ctrl = await db.getEvictionCandidates(99, 5.1, 50);
    expect(ctrl.sessions.find(s => s.id === 'r517-sess')).toBeDefined();

    // the finding arm: with threshold 4.9 a session whose score became 0.0
    // (5.0 - 5.0) WOULD be a candidate.  It is not.
    const cand = await db.getEvictionCandidates(99, 4.9, 50);
    const sess = cand.sessions.find(s => s.id === 'r517-sess');

    // the row is NOT a candidate -> its effective importance is still 5.0
    expect(sess).toBeUndefined();
  });
});
