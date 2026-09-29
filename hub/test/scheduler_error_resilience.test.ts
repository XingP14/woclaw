/**
 * Error-resilience tests for ForgettingScheduler.
 *
 * Why this file exists: every one of the four `catch` blocks in
 * hub/src/scheduler.ts had ZERO coverage — the only pre-existing suite
 * (forgetting_scheduler.test.ts) drives purely happy paths with mocks that
 * always resolve. These are the highest-risk uncovered branches in the file,
 * because they are the code that decides whether ONE bad row takes down an
 * entire nightly run:
 *
 *   - scheduler.ts:125  daily scan catch  — a getAllSessions/addToExtractionQueue
 *                       throw is swallowed and logged instead of rejecting the
 *                       03:00 UTC cron callback (an unhandled rejection in a
 *                       node-cron task can take down the process).
 *   - scheduler.ts:162  per-session catch — one un-deletable session must not
 *                       abort the remaining eviction loop.
 *   - scheduler.ts:175  per-memory catch  — same, for the memory loop.
 *   - scheduler.ts:185  weekly catch      — getEvictionCandidates throwing must
 *                       degrade to a zero result, not propagate.
 *
 * The load-bearing invariant is PARTIAL PROGRESS: after a mid-loop failure the
 * scheduler must still have evicted everything else, and must still resolve
 * with accurate counts. A blanket catch that swallowed the error and returned
 * {0,0} would satisfy `expect(...).resolves` but silently skip every eviction.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ForgettingScheduler } from '../src/scheduler.js';
import type { ClawDB } from '../src/db.js';
import type { SessionStore } from '../src/session_store.js';
import type { DBSession } from '../src/types.js';

function makeSession(overrides: Partial<DBSession> = {}): DBSession {
  return {
    id: 'sess-test',
    agentId: 'agent-x',
    framework: 'openclaw',
    startedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    transcript: '[]',
    importance: 7.5,
    accessCount: 1,
    tags: [],
    extracted: false,
    flagged: false,
    createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function createMockDB() {
  return {
    getAllSessions: vi.fn(),
    addToExtractionQueue: vi.fn(),
    getExtractionQueue: vi.fn(),
    updateExtractionQueueStatus: vi.fn(),
    removeFromExtractionQueue: vi.fn(),
    deleteMemory: vi.fn(),
    getEvictionCandidates: vi.fn(),
    setForgettingScheduler: vi.fn(),
    deleteSession: vi.fn(),
  } as unknown as ClawDB;
}

function createMockSessionStore() {
  return {
    registerSession: vi.fn(),
    updateSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
    searchSessions: vi.fn(),
    flagSession: vi.fn(),
    markExtracted: vi.fn(),
    incrementAccessCount: vi.fn(),
    addFeedback: vi.fn(),
  } as unknown as SessionStore;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runDailyExtractionScan error resilience (scheduler.ts:125 catch)', () => {
  it('swallows a getAllSessions rejection and logs instead of propagating', async () => {
    const db = createMockDB();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (db.getAllSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('db locked'),
    );
    const scheduler = new ForgettingScheduler(db, createMockSessionStore(), null);

    // Must NOT reject: this runs inside a node-cron callback with no awaiter.
    await expect(scheduler.runDailyExtractionScan()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(db.addToExtractionQueue).not.toHaveBeenCalled();
  });

  it('swallows a mid-loop addToExtractionQueue rejection and stops queueing further sessions', async () => {
    const db = createMockDB();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const oldEnough = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (db.getAllSessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeSession({ id: 'a', startedAt: oldEnough }),
      makeSession({ id: 'b', startedAt: oldEnough }),
      makeSession({ id: 'c', startedAt: oldEnough }),
    ]);
    (db.addToExtractionQueue as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('queue write failed'));

    const scheduler = new ForgettingScheduler(db, createMockSessionStore(), null);
    await expect(scheduler.runDailyExtractionScan()).resolves.toBeUndefined();

    // 'a' was queued, 'b' threw and aborted the loop, 'c' never attempted.
    expect(db.addToExtractionQueue).toHaveBeenCalledTimes(2);
  });
});

describe('runWeeklyEviction per-item resilience (scheduler.ts:162 / :175 catches)', () => {
  it('keeps evicting sessions after one deleteSession throws', async () => {
    const db = createMockDB();
    const sessionStore = createMockSessionStore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    (db.getEvictionCandidates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      memories: [],
      sessions: [
        { id: 'ok-1', importance: 1.0, lastAccessedAt: 0, accessCount: 0 },
        { id: 'boom', importance: 1.0, lastAccessedAt: 0, accessCount: 0 },
        { id: 'ok-2', importance: 1.0, lastAccessedAt: 0, accessCount: 0 },
      ],
    });
    (sessionStore.deleteSession as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('session row locked'))
      .mockResolvedValueOnce(true);

    const scheduler = new ForgettingScheduler(db, sessionStore, null);
    const result = await scheduler.runWeeklyEviction();

    // The three survivors are the whole point: a blanket abort would give 0.
    expect(sessionStore.deleteSession).toHaveBeenCalledTimes(3);
    expect(result.sessions).toBe(2);
  });

  it('keeps evicting memories after one deleteMemory throws', async () => {
    const db = createMockDB();
    const sessionStore = createMockSessionStore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    (db.getEvictionCandidates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [],
      memories: [
        { key: 'm-ok-1', importance: 0.5, lastAccessedAt: 0, accessCount: 0 },
        { key: 'm-boom', importance: 0.5, lastAccessedAt: 0, accessCount: 0 },
        { key: 'm-ok-2', importance: 0.5, lastAccessedAt: 0, accessCount: 0 },
      ],
    });
    (db.deleteMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('memory row locked'))
      .mockResolvedValueOnce(true);

    const scheduler = new ForgettingScheduler(db, sessionStore, null);
    const result = await scheduler.runWeeklyEviction();

    expect(db.deleteMemory).toHaveBeenCalledTimes(3);
    expect(result.memories).toBe(2);
  });

  it('does not count a failed-but-resolved delete, and a session failure does not stop the memory loop', async () => {
    const db = createMockDB();
    const sessionStore = createMockSessionStore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    (db.getEvictionCandidates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [{ id: 's-false', importance: 1.0, lastAccessedAt: 0, accessCount: 0 }],
      memories: [{ key: 'm-still-deleted', importance: 0.5, lastAccessedAt: 0, accessCount: 0 }],
    });
    // deleteSession resolves false (not a throw) — the `if (ok)` guard must
    // leave the counter alone, and the memory loop must still run.
    (sessionStore.deleteSession as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (db.deleteMemory as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const scheduler = new ForgettingScheduler(db, sessionStore, null);
    const result = await scheduler.runWeeklyEviction();

    expect(result.sessions).toBe(0);
    expect(result.memories).toBe(1);
    expect(db.deleteMemory).toHaveBeenCalledWith('m-still-deleted');
  });
});

describe('runWeeklyEviction outer catch (scheduler.ts:185)', () => {
  it('degrades to a zero result when getEvictionCandidates throws', async () => {
    const db = createMockDB();
    const sessionStore = createMockSessionStore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    (db.getEvictionCandidates as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('candidate query failed'),
    );
    const scheduler = new ForgettingScheduler(db, sessionStore, null);

    await expect(scheduler.runWeeklyEviction()).resolves.toEqual({
      sessions: 0,
      memories: 0,
    });
    expect(sessionStore.deleteSession).not.toHaveBeenCalled();
    expect(db.deleteMemory).not.toHaveBeenCalled();
  });

  it('propagates the same degraded result through triggerEviction', async () => {
    const db = createMockDB();
    const sessionStore = createMockSessionStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    (db.getEvictionCandidates as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const scheduler = new ForgettingScheduler(db, sessionStore, null);

    await expect(scheduler.triggerEviction()).resolves.toEqual({
      sessions: 0,
      memories: 0,
    });
  });
});
