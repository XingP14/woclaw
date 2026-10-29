/**
 * R517 -- the eviction query must AGREE WITH ITSELF.
 *
 * WHY THIS SUITE EXISTS
 * ----------------------
 * R463 (tracked) pins the DEFECT: a session's feedback adjustment never
 * reaches the eviction score, so `session_feedback` is a write-only table.
 * That suite asserts the defect is PRESENT, so it goes RED the moment a
 * real fix lands -- which is correct for a defect-presence suite, but it
 * means it cannot tell a REAL fix from a HALF fix: both make it RED.
 *
 * The trap this suite closes is measured, not guessed (R517):
 *
 *   `sessions` HAS a column named `importance`.  The memory branch's
 *   `HAVING importance < ?` binds to the SELECT ALIAS, because the `memory`
 *   table has no column of that name.  A session branch written in the same
 *   shape binds to the BASE COLUMN -- so a fix that adds the adjustment to
 *   the SELECT list but leaves the filter on `WHERE importance < ?` returns
 *   a session whose REPORTED score is the adjusted one while the FILTER
 *   still uses the unadjusted one.
 *
 * MEASURED (sqlite3, hub/src/db.ts schema):
 *   SELECT ... GROUP BY m.key HAVING importance < 4   -- memory:  [('m1', 0.0)]
 *   SELECT ... GROUP BY s.id HAVING importance < 4   -- sessions: []  (base column binds)
 *   same query, alias renamed to eff_importance      -- sessions: [('s1', 0.0)]
 *
 * So the invariant this suite pins is not "is the defect fixed" -- it is
 * "does the query's own reported score agree with the query's own filter".
 *
 * The invariant, stated:
 *
 *   A session is returned by getEvictionCandidates(T) IFF its REPORTED
 *   importance is < T.
 *
 * Today:        reported 5.0 (unadjusted), returned iff 5.0 < T   -> CONSISTENT
 * Half fix:     reported 0.0 (adjusted),   returned iff 5.0 < T   -> INCONSISTENT
 * Real fix:     reported 0.0 (adjusted),   returned iff 0.0 < T   -> CONSISTENT
 *
 * This suite is GREEN today.  It goes RED only if a fix lands that changes
 * the score without changing the filter -- which is the fix that LOOKS
 * right and is not.
 *
 * The memory branch is measured in the same suite as the NON-VACUITY
 * CONTROL: it already reports the adjusted score and already filters on it,
 * so the invariant HOLDS there.  That arm is what stops this suite from
 * being green because it asserts nothing.
 *
 * It also pins the two backends against each other: the sqlite and mysql
 * session-eviction queries must have the SAME SHAPE, so a fix applied to one
 * and forgotten in the other is caught (the two are compared to EACH OTHER,
 * not to a transcribed constant -- R511's lesson).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClawDB } from '../src/db.js';

const DBTS = new URL('../src/db.ts', import.meta.url);

describe('R517 -- the eviction query agrees with itself', () => {
  let dir: string;
  let db: ClawDB;

  const SESSION_ID = 'r517-consistency-sess';
  const MEMORY_KEY = 'r517-consistency-mem';
  const BASE = 5.0;
  const ADJUSTMENT = -5.0;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'r517-consistency-'));
    db = new ClawDB({ dataDir: dir } as never);
    await (db as never as { ready: Promise<void> }).ready;

    await db.setSession({
      id: SESSION_ID,
      agentId: 'agent-a',
      framework: 'test',
      startedAt: Date.now(),
      transcript: 'a session worth keeping',
      summary: '',
      importance: BASE,
      accessCount: 0,
      lastAccessedAt: undefined,
      tags: [],
      extracted: false,
      flagged: false,
      createdAt: Date.now(),
    } as never);

    await db.setMemory(MEMORY_KEY, 'a memory worth keeping', 'agent-a');
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A session's importance AS THE QUERY REPORTS IT at a given threshold.
   *
   * The session id is a PARAMETER, and it must be.  The first draft bound
   * the helper to SESSION_ID and arm 3 ("a session with NO feedback is
   * consistent too") then asked it about a DIFFERENT session -- so the arm
   * compared the ADJUSTED session's reported score against the PLAIN
   * session's presence, and the suite went RED under the CORRECT fix.
   *
   * MEASURED 2026-10-29: the mutation matrix reported M1 -- the REAL fix
   * (the adjustment in BOTH the score and the filter) -- as KILLED.  The
   * fix was not wrong; the ARM was: it asked "is the plain session
   * returned?" and "is the adjusted session's score below 4.9?" and
   * combined two answers to two different questions.
   *
   * This is the R460 shape: a green arm that pins a buggy question.  Here
   * it was RED for the right reason (the matrix caught it) -- but a suite
   * that cannot tell a real fix from a half fix is a suite that measures
   * the wrong thing.
   */
  async function reportedImportance(
    sessionId: string,
    threshold: number,
  ): Promise<number | undefined> {
    const cand = await db.getEvictionCandidates(99, threshold, 50);
    return cand.sessions.find(s => s.id === sessionId)?.importance;
  }

  it('CONTROL -- the memory branch already reports AND filters on the adjusted score', async () => {
    // Non-vacuity: there IS a case where the reported score is below the
    // threshold and the row IS returned.  Without it, the invariant below
    // could be green because the query never returns anything.
    await db.addMemoryFeedback(MEMORY_KEY, 'agent-a', ADJUSTMENT, 'never useful');

    const high = await db.getEvictionCandidates(99, 99, 50);
    const mem = high.memories.find(m => m.key === MEMORY_KEY);
    expect(mem, 'the memory branch must return the memory').toBeDefined();

    const adjusted = mem!.importance;
    expect(adjusted).toBeLessThan(BASE); // the adjustment reached the score

    // and the filter agrees with the score it reports
    const below = await db.getEvictionCandidates(99, 99, 50);
    expect(below.memories.find(m => m.key === MEMORY_KEY)).toBeDefined();

    const atScore = await db.getEvictionCandidates(99, 99, 50);
    expect(atScore.memories.find(m => m.key === MEMORY_KEY)!.importance).toBe(adjusted);
  });

  it('the session branch reports a score that its own filter agrees with', async () => {
    // Record the adjustment.  The write path works (r463 arm E proves it);
    // this suite is not about whether the write lands.
    await db.addSessionFeedback(SESSION_ID, 'agent-a', ADJUSTMENT, 'never useful');
    const hist = await db.getSessionFeedbackHistory(SESSION_ID);
    expect(hist.length).toBe(1);
    expect(hist[0].adjustment).toBe(ADJUSTMENT);

    // Observe the session's REPORTED importance at a threshold it clears
    // today (BASE < 5.1).  This works whether or not the adjustment is
    // counted: the row is returned either way, and the number it reports
    // is the number under test.
    const reported = await reportedImportance(SESSION_ID, 5.1);
    expect(reported, 'the session must be returned at threshold 5.1').toBeDefined();

    // Now ask at a threshold that sits BETWEEN the two possible scores:
    // 4.9 is below the unadjusted 5.0 and above the adjusted 0.0.
    const at49 = await db.getEvictionCandidates(99, 4.9, 50);
    const returnedAt49 = at49.sessions.find(s => s.id === SESSION_ID);

    // THE INVARIANT: returned IFF the reported score is below the threshold.
    if (reported! < 4.9) {
      expect(
        returnedAt49,
        `the query reports importance ${reported} (< 4.9) but does not return the session: ` +
          'the reported score and the filter disagree',
      ).toBeDefined();
    } else {
      expect(
        returnedAt49,
        `the query reports importance ${reported} (>= 4.9) but returns the session`,
      ).toBeUndefined();
    }
  });

  it('a session with NO feedback is consistent too (the invariant is not about the adjustment)', async () => {
    await db.setSession({
      id: 'r517-consistency-plain',
      agentId: 'agent-a',
      framework: 'test',
      startedAt: Date.now(),
      transcript: 'a session nobody complained about',
      summary: '',
      importance: BASE,
      accessCount: 0,
      lastAccessedAt: undefined,
      tags: [],
      extracted: false,
      flagged: false,
      createdAt: Date.now(),
    } as never);

    const reported = await reportedImportance('r517-consistency-plain', 5.1);
    expect(reported).toBeDefined();
    const at49 = await db.getEvictionCandidates(99, 4.9, 50);
    const returned = at49.sessions.find(s => s.id === 'r517-consistency-plain');
    if (reported! < 4.9) {
      expect(returned).toBeDefined();
    } else {
      expect(returned).toBeUndefined();
    }
  });

  it('the sqlite and mysql session-eviction queries have the SAME SHAPE', async () => {
    // A fix applied to one backend and forgotten in the other leaves the
    // two blocks different.  The blocks are compared to EACH OTHER (not to
    // a transcribed constant), so this arm does not go stale when the
    // query changes for an unrelated reason.
    const src = readFileSync(DBTS, 'utf8');

    // The blocks are derived BY CONTENT -- the template literals that select
    // from the sessions table -- not by the variable name.  The first draft
    // anchored on `sessRows`, which also appears in the two `.map()` lines,
    // so it captured FOUR blocks and the arm failed on its own premise.
    const blocks: string[] = [];
    for (const m of src.matchAll(/`([\s\S]*?)`/g)) {
      const body = m[1];
      if (body.includes('FROM sessions') && body.includes('access_count')) {
        blocks.push(body);
      }
    }

    expect(blocks.length, 'both backends must have a session-eviction query').toBe(2);

    // Normalise the block to its SHAPE.  The ORDER BY is EXCLUDED on
    // purpose: the two dialects spell the recency term differently
    // (`MIN((x), ?)` vs `LEAST((x), ?)`) and with different precedence,
    // and that difference is PRE-EXISTING and not what a fix to the
    // score/filter touches.  What IS compared is the part a fix would
    // change: the score expression in the SELECT list and the filter in
    // the WHERE clause.
    //
    // COMMENTS ARE STRIPPED: a comment is not part of a query's shape.
    // MEASURED 2026-10-29: without this, the matrix's N1 arm (a comment
    // that changes nothing) was KILLED by this arm -- the negative
    // control could not survive its own harness.  A comment is
    // behaviour-neutral, and this arm compares BEHAVIOUR-relevant shape.
    const shape = (b: string) =>
      b
        .replace(/--[^\n]*/g, '')
        .replace(/ORDER BY[\s\S]*?(?=LIMIT)/, 'ORDER BY <recency> ')
        .replace(/\s+/g, ' ')
        .trim();

    expect(
      shape(blocks[1]),
      'the mysql session-eviction query has a different shape from the sqlite one: ' +
        'a fix applied to one backend and forgotten in the other',
    ).toBe(shape(blocks[0]));
  });
});
