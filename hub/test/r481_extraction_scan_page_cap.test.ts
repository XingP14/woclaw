/**
 * r481 — ForgettingScheduler.runDailyExtractionScan() judges ONE page of the
 *        200 NEWEST sessions, and the eligibility filter it applies has a
 *        7-day age clause.
 *
 * WHY (2026-10-18 cron, woclaw rotation).
 *
 * scheduler.ts:111 calls
 *     this.db.getAllSessions(undefined, undefined, 200, 0)
 * — a single unpaginated read. The store (db.ts:870 SQLite, :1494 MySQL) does
 *     ORDER BY started_at DESC LIMIT ? OFFSET ?
 * so the 200 rows returned are the 200 MOST RECENTLY STARTED sessions in the
 * whole table. There is no loop, no second page, no total count, and no filter
 * pushed down into SQL.
 *
 * The eligibility test is applied AFTER that read, in JS:
 *     !s.extracted && s.importance >= 6.0 && (s.endedAt ?? s.startedAt) < now - 7d
 *
 * Put those two facts together and the age clause becomes a bug amplifier. The
 * newest sessions are exactly the ones the 7-day test REJECTS, and they sit at
 * the head of the DESC order, displacing the oldest — which are exactly the
 * ones it ACCEPTS. The read is sorted against its own filter.
 *
 * MEASURED CONSEQUENCE (arm 2). 250 sessions: the 200 newest are all recent
 * (ineligible by age), the 50 oldest are all important + unextracted (eligible).
 * The scan queues 0 and drops all 50, with no error and no retry marker. The
 * backlog is not merely slow — it is invisible, and the queue insert is
 * addToExtractionQueue(sessionId, priority) one row at a time, so there is no
 * batch to notice an empty result.
 *
 * The one log line the scan emits is the tell:
 *     "Daily scan complete — queued 0 sessions"
 * which is indistinguishable from "the table is healthy".
 *
 * WHY THIS SUITE DOES NOT REPAIR. The fix is not obviously "raise 200" or
 * "add a while loop". Push the age clause into SQL and the scan's own
 * correctness depends on the column that gets updated; loop the pages and the
 * daily job starts racing its own weekly eviction (which deletes the same low-
 * ranked rows) with no cross-lock; raise the cap and you have moved a silent
 * truncation to a louder one. This suite pins CURRENT behaviour, which is the
 * thing that has to change.
 *
 * Arms (3)-(4) are the candidate repairs, each RED on purpose.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ForgettingScheduler } from '../src/scheduler.js';
import type { ClawDB } from '../src/db.js';
import type { SessionStore } from '../src/session_store.js';
import type { DBSession } from '../src/types.js';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function makeSession(id: string, startedAt: number, importance: number, extracted = false): DBSession {
  return {
    id,
    agentId: 'agent-x',
    framework: 'openclaw',
    startedAt,
    endedAt: startedAt,
    transcript: '[]',
    importance,
    accessCount: 1,
    tags: [],
    extracted,
    flagged: false,
    createdAt: startedAt,
  } as DBSession;
}

/**
 * A table whose newest 200 rows are all RECENT (rejected by the 7-day clause)
 * and whose oldest 50 are all ELIGIBLE. Ordered started_at DESC, this is what
 * getAllSessions(…, 200, 0) actually returns.
 */
function makeCrowdedTable() {
  const eligible = Array.from({ length: 50 }, (_, i) =>
    makeSession(`old-eligible-${String(i).padStart(2, '0')}`, Date.now() - (60 + i) * DAY, 7.5),
  );
  const recent = Array.from({ length: 200 }, (_, i) =>
    makeSession(`recent-${String(i).padStart(3, '0')}`, Date.now() - (1 + i * 0.01) * DAY, 7.5),
  );
  // The DESC order the store guarantees.
  return { eligible, recent, ordered: [...recent, ...eligible] };
}

function makeScheduler(table: { ordered: DBSession[] }) {
  const addToExtractionQueue = vi.fn(async () => {});
  const getEvictionCandidates = vi.fn(async () => ({ memories: [], sessions: [] }));
  // A faithful store: honours the caller's LIMIT/OFFSET over the DESC ordering.
  const getAllSessions = vi.fn(async (_a?: string, _f?: string, limit = 50, offset = 0) =>
    table.ordered.slice(offset, offset + limit),
  );
  const db = { getAllSessions, addToExtractionQueue, getEvictionCandidates } as unknown as ClawDB;
  const scheduler = new ForgettingScheduler(db, {} as SessionStore, null, { enabled: true });
  const run = async () =>
    (scheduler as unknown as { runDailyExtractionScan(): Promise<void> }).runDailyExtractionScan();
  return { scheduler, run, getAllSessions, addToExtractionQueue, queuedIds: () => addToExtractionQueue.mock.calls.map((c) => c[0] as string) };
}

afterEach(() => vi.restoreAllMocks());

describe('r481: the daily extraction scan judges one page of 200 newest sessions', () => {
  it('(1) the read is a single call, limit 200, offset 0, with no filter pushed down', async () => {
    // ARM 1 — the shape of the read. One page, hard cap, DESC from the head.
    const { run, getAllSessions } = makeScheduler(makeCrowdedTable());
    await run();

    expect(getAllSessions).toHaveBeenCalledTimes(1);
    expect(getAllSessions).toHaveBeenCalledWith(undefined, undefined, 200, 0);
  });

  it('(2) 200 recent + 50 old-eligible: the scan queues 0 and the whole eligible backlog is dropped', async () => {
    // ARM 2 — measured consequence, not a shortfall but an inversion. The 200
    // newest rows all fail the 7-day test, so the rows the cron job exists to
    // process are the ones it never reads.
    const table = makeCrowdedTable();
    const { run, addToExtractionQueue, queuedIds } = makeScheduler(table);
    await run();

    expect(table.eligible).toHaveLength(50);
    expect(addToExtractionQueue).toHaveBeenCalledTimes(0);
    for (const id of table.eligible.map((s) => s.id)) {
      expect(queuedIds()).not.toContain(id);
    }
  });

  it('(3) REPAIR ARM — a paginating or SQL-filtering scan reaches the old-eligible sessions', async () => {
    // RED on purpose. Any of: loop the pages, push the 7-day clause into SQL,
    // or drop the DESC. Turns GREEN when the fix lands.
    const table = makeCrowdedTable();
    const { run, addToExtractionQueue, queuedIds } = makeScheduler(table);
    await run();

    expect(addToExtractionQueue).toHaveBeenCalledTimes(50);
    expect(queuedIds()).toContain('old-eligible-49');
  });

  it('(4) REPAIR ARM — an empty result is reported as suspicious rather than healthy', async () => {
    // RED on purpose. "queued 0 sessions" is the same string whether the table
    // is healthy or the whole backlog was skipped; the honest line names the
    // shortfall.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { run } = makeScheduler(makeCrowdedTable());
    await run();

    const said = vi.mocked(console.log).mock.calls.flat().join(' ');
    expect(said).toMatch(/skipped|truncat|more than|page/i);
  });
});
