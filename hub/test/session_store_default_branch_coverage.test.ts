/**
 * Branch-coverage closure for SessionStore default/guard paths.
 *
 * Closes the 7 uncovered branches in hub/src/session_store.ts:
 *   - registerSession: `extracted ?? false`, `flagged ?? false`, `createdAt ?? Date.now()`
 *     (only `accessCount` and `tags` defaults had coverage before).
 *   - flagSession / markExtracted / incrementAccessCount: the `!existing`
 *     not-found guard branches were never taken.
 *   - incrementAccessCount: `existing.accessCount ?? 0` nullish fallback.
 *
 * 0 production changes — behaviour-only assertions.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionStore } from '../src/session_store.js';
import type { ClawDB } from '../src/db.js';
import type { DBSession } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<DBSession> = {}): DBSession {
  const now = Date.now();
  return {
    id: 'sess-branch',
    agentId: 'agent-x',
    framework: 'openclaw',
    startedAt: now - 86400000,
    endedAt: now,
    transcript: '[]',
    importance: 5.0,
    accessCount: 0,
    tags: [],
    extracted: false,
    flagged: false,
    createdAt: now - 86400000,
    ...overrides,
  };
}

/**
 * Mock ClawDB whose getSession/setSession are driven by an explicit map so a
 * test can seed a record with fields stripped (e.g. accessCount undefined).
 */
function createMockDB(seed: DBSession[] = []) {
  const sessions = new Map<string, DBSession>(seed.map((s) => [s.id, s]));
  return {
    sessions,
    setSession: vi.fn(async (s: DBSession) => { sessions.set(s.id, s); }),
    getSession: vi.fn(async (id: string) => sessions.get(id)),
    getAllSessions: vi.fn(async (_?: string, __?: string, limit = 50) =>
      Array.from(sessions.values()).slice(0, limit)),
    sessionSearch: vi.fn(async () => Array.from(sessions.values())),
    deleteSession: vi.fn(async (id: string) => sessions.delete(id)),
    addSessionFeedback: vi.fn(async () => {}),
  } as unknown as ClawDB & { sessions: Map<string, DBSession>; setSession: ReturnType<typeof vi.fn> };
}

function lastStored(db: ReturnType<typeof createMockDB>): DBSession {
  const calls = db.setSession.mock.calls;
  return calls[calls.length - 1][0] as DBSession;
}

// ─── registerSession: remaining default branches ─────────────────────────────

describe('registerSession defaults (branch closure)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('defaults extracted to false when omitted', async () => {
    const db = createMockDB();
    const store = new SessionStore(db);
    const s = makeSession({ id: 'd-extracted' });
    delete (s as Partial<DBSession>).extracted;
    expect(s.extracted).toBeUndefined();

    await store.registerSession(s);

    expect(lastStored(db).extracted).toBe(false);
  });

  it('defaults flagged to false when omitted', async () => {
    const db = createMockDB();
    const store = new SessionStore(db);
    const s = makeSession({ id: 'd-flagged' });
    delete (s as Partial<DBSession>).flagged;
    expect(s.flagged).toBeUndefined();

    await store.registerSession(s);

    expect(lastStored(db).flagged).toBe(false);
  });

  it('defaults createdAt to Date.now() when omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const db = createMockDB();
    const store = new SessionStore(db);
    const s = makeSession({ id: 'd-created' });
    delete (s as Partial<DBSession>).createdAt;
    expect(s.createdAt).toBeUndefined();

    await store.registerSession(s);

    expect(lastStored(db).createdAt).toBe(1767323045000);
  });

  it('preserves supplied extracted/flagged/createdAt instead of defaulting', async () => {
    const db = createMockDB();
    const store = new SessionStore(db);
    await store.registerSession(
      makeSession({ id: 'keep-vals', extracted: true, flagged: true, createdAt: 42 }),
    );

    const stored = lastStored(db);
    expect(stored.extracted).toBe(true);
    expect(stored.flagged).toBe(true);
    expect(stored.createdAt).toBe(42);
  });
});

// ─── not-found guards on the three mutators ──────────────────────────────────

describe('flagSession / markExtracted / incrementAccessCount not-found guards', () => {
  it('flagSession rejects when the session does not exist', async () => {
    const db = createMockDB();
    const store = new SessionStore(db);

    await expect(store.flagSession('ghost', true)).rejects.toThrow('Session not found: ghost');
    expect(db.setSession).not.toHaveBeenCalled();
  });

  it('markExtracted rejects when the session does not exist', async () => {
    const db = createMockDB();
    const store = new SessionStore(db);

    await expect(store.markExtracted('ghost')).rejects.toThrow('Session not found: ghost');
    expect(db.setSession).not.toHaveBeenCalled();
  });

  it('incrementAccessCount rejects when the session does not exist', async () => {
    const db = createMockDB();
    const store = new SessionStore(db);

    await expect(store.incrementAccessCount('ghost')).rejects.toThrow('Session not found: ghost');
    expect(db.setSession).not.toHaveBeenCalled();
  });

  it('flagSession unflags an existing session (flagged=false path)', async () => {
    const db = createMockDB([makeSession({ id: 'unflag', flagged: true })]);
    const store = new SessionStore(db);

    await store.flagSession('unflag', false);

    expect(lastStored(db).flagged).toBe(false);
  });
});

// ─── incrementAccessCount: nullish accessCount fallback ───────────────────────

describe('incrementAccessCount nullish accessCount fallback', () => {
  it('treats a missing accessCount as 0 and stores 1', async () => {
    const s = makeSession({ id: 'no-count' });
    delete (s as Partial<DBSession>).accessCount;
    const db = createMockDB([s]);
    const store = new SessionStore(db);

    await store.incrementAccessCount('no-count');

    const stored = lastStored(db);
    expect(stored.accessCount).toBe(1);
    expect(stored.lastAccessedAt).toBeGreaterThan(0);
  });

  it('increments from an explicit 0 to 1', async () => {
    const db = createMockDB([makeSession({ id: 'zero-count', accessCount: 0 })]);
    const store = new SessionStore(db);

    await store.incrementAccessCount('zero-count');

    expect(lastStored(db).accessCount).toBe(1);
  });
});
