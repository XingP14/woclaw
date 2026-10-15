/**
 * R463: the SESSION half of the forgetting path has a WRITER and no READER.
 *
 * R456 found the memory half has no writer. Measured first, then pinned here,
 * because this is the same defect with the halves SWAPPED — and the swap is
 * what makes it invisible:
 *
 *   F1  POST /sessions/:id/feedback IS a live production route
 *       (rest_server.ts:1243 -> handleSessionFeedback -> sessionStore.addFeedback
 *        -> db.addSessionFeedback). So the session half HAS a writer.
 *   F2  The writer persists a row: the probe read 1 row back from
 *       getSessionFeedbackHistory. The write is durable, not a no-op.
 *   F3  getEvictionCandidates' session branch joins NOTHING:
 *         SELECT id, importance, ... FROM sessions WHERE importance < ?
 *       There is no LEFT JOIN session_feedback, and no
 *       COALESCE(...,0) + COALESCE(SUM(f.adjustment),0) — the exact shape the
 *       memory branch has at db.ts:947-957. `grep` proves the join is absent
 *       from BOTH backends (sqlite L958-963 and mysql L1584-1590).
 *   F4  Therefore the ONLY lever that can move a session below the floor does
 *       not move it. Measured: s-default at importance 5.0 stays at 5.0 after
 *       -10 of feedback, and the weekly run still does not select it.
 *   F5  The asymmetry is load-bearing, and the contrast is what proves F3 is a
 *       real omission rather than a design choice: memory_feedback IS joined
 *       (db.ts:952/1577) and DOES move the ranking — arm D below measures that
 *       live, in the same process, in the same call.
 *
 * Net effect: a user's explicit "this session was wrong, -10" is accepted with
 * HTTP 200, stored, and never consulted by anything. The session half of the
 * forgetting path is a write-only table.
 *
 * Why this is NOT r456 again: r456 arm D/E drove memory_feedback by hand and
 * showed the MEMORY branch honours it. The memory branch is the CORRECT half.
 * This suite pins the half r456 did not cover, and pins it by ASYMMETRY against
 * the working half in the same database — which also means a "fix" that made
 * both halves symmetric in the wrong direction would redden arm D.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClawDB } from '../src/db.js';
import { ForgettingScheduler } from '../src/scheduler.js';
import type { DBSession } from '../src/types.js';
import { readFileSync } from 'node:fs';

const FLOOR = 3.0; // DEFAULT_CONFIG.importanceFloor in scheduler.ts

function mkSession(id: string, importance: number): DBSession {
  const now = Date.now();
  return {
    id, agentId: 'agent-a', framework: 'openclaw',
    startedAt: now, transcript: '[]',
    importance, accessCount: 0, tags: [], extracted: false, flagged: false,
    createdAt: now,
  };
}

describe('R463 — session feedback has a writer and no reader', () => {
  let dir: string;
  let db: ClawDB;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'R463-'));
    db = new ClawDB(dir);
    await new Promise(r => setTimeout(r, 60));
  });
  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('arm A: negative session feedback does NOT move a session into the eviction set', async () => {
    await db.setSession(mkSession('s-default', 5.0));
    await db.addSessionFeedback('s-default', 'agent-a', -10, 'completely wrong');
    const cand = await db.getEvictionCandidates(FLOOR, FLOOR, 50);
    // the finding: a -10 against a 5.0 should read as -5, which is < 3.0.
    expect(cand.sessions.map(s => s.id)).not.toContain('s-default');
  });

  it('arm B: the gate is LIVE, not dead SQL — the session branch DOES select a low session', async () => {
    // The control that stops arm A passing vacuously (R421-1).
    // If the SELECT were broken, arm B would also return [].
    await db.setSession(mkSession('s-low', 1.0));
    const cand = await db.getEvictionCandidates(FLOOR, FLOOR, 50);
    expect(cand.sessions.map(s => s.id)).toEqual(['s-low']);
  });

  it('arm C: the stored importance is unchanged by feedback — the row and the SELECT agree', async () => {
    // Separates "the write is a no-op" from "the write lands but nothing reads it".
    // The writer is NOT the defect here (arm D proves the row persists).
    await db.setSession(mkSession('s-default', 5.0));
    await db.addSessionFeedback('s-default', 'agent-a', -10, 'wrong');
    const stored = await db.getSession('s-default');
    expect(stored).toBeDefined();
    expect(stored!.importance).toBe(5.0);
  });

  it('arm D: memory_feedback DOES move its ranking, live, in the same database', async () => {
    // The asymmetry control. This is what makes arm A a FINDING rather than a
    // statement about the design: the sibling branch, same process, same call,
    // same floor, honours its feedback table.
    await db.setMemory('k', 'v', 'agent-a');
    const before = await db.getEvictionCandidates(FLOOR, FLOOR, 50);
    expect(before.memories).toEqual([]);
    await db.addMemoryFeedback('k', 'agent-a', -10, 'wrong');
    const after = await db.getEvictionCandidates(FLOOR, FLOOR, 50);
    expect(after.memories.map(m => m.key)).toEqual(['k']);
  });

  it('arm E: the write really does persist — the row comes back', async () => {
    // Closes the "maybe the writer is dead, so there is nothing to read" exit.
    // Also pins the production path end-to-end: the clamp in SessionStore is
    // [-5,+5], so a REST -10 arrives as -5.
    await db.setSession(mkSession('s-default', 5.0));
    await db.addSessionFeedback('s-default', 'agent-a', -5, 'wrong');
    const hist = await db.getSessionFeedbackHistory('s-default');
    expect(hist.length).toBe(1);
    expect(hist[0]!.adjustment).toBe(-5);
  });

  it('arm F: WITHOUT feedback the same session survives; the -5 is the ONLY difference', async () => {
    // The weekly run, end to end, both ways.
    await db.setSession(mkSession('s-default', 5.0));
    const sched = new ForgettingScheduler(db, null as never, null);
    const result = await sched.triggerEviction();
    expect(result.sessions).toBe(0);
    expect(await db.getSession('s-default')).toBeDefined();
  });

  it('arm G: WITH -5 of feedback the weekly run still does not evict it', async () => {
    // The same run as arm F, with the single variable changed. If this ever
    // goes green the defect is fixed and this suite is WRONG — read it then.
    await db.setSession(mkSession('s-default', 5.0));
    await db.addSessionFeedback('s-default', 'agent-a', -5, 'wrong');
    const sched = new ForgettingScheduler(db, null as never, null);
    const result = await sched.triggerEviction();
    expect(result.sessions).toBe(0);
    expect(await db.getSession('s-default')).toBeDefined();
  });

  it('arm H: both backends omit the session_feedback join — the omission is not a sqlite-only accident', async () => {
    // The behavioural arms above all run against sqlite. Without this, a fix
    // that patched only the sqlite branch would leave mysql broken and every
    // arm here still GREEN.
    const src = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
    // Every getEvictionCandidates implementation: the memory branch must join
    // its feedback table. If a session branch ever grows one, this reddens.
    const joins = src.match(/LEFT JOIN memory_feedback/g) ?? [];
    expect(joins.length).toBe(2); // sqlite + mysql
    // The session half: NO reader for session_feedback anywhere in the module.
    // Matched on JOIN, not "FROM" — a real fix joins the table, so a
    // FROM-anchored gate would be unfailable against exactly the patch it is
    // meant to catch (the #188 shape). Anchored on JOIN so both the LEFT JOIN
    // a fix would write and any other join form trip it.
    const sessionJoins = src.match(/JOIN\s+session_feedback/g) ?? [];
    expect(sessionJoins.length).toBe(0);
    // Sanity: the only two readers are getSessionFeedbackHistory, one per
    // backend. Guards the match above against silently matching nothing.
    const readers = src.match(/FROM session_feedback/g) ?? [];
    expect(readers.length).toBe(2); // sqlite + mysql history SELECT
  });
});
