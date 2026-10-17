/**
 * R479 — the periodic federation sync engine is armed, timed, and reachable
 * from nowhere.
 *
 * The shape under test is a three-part chain that a reader would reasonably
 * assume is connected end to end:
 *
 *   1. `FederationManager.startPeriodicSync()` (hub/src/federation.ts:68-78)
 *      arms a `setInterval` whenever `config.federationSync.enabled` is set
 *      and `syncIntervalMs` is truthy. It logs a line announcing the interval
 *      and the threshold.
 *   2. Every tick calls `syncImportantMemories()` (federation.ts:225-237),
 *      which asks the registered `getMemoriesForSync` provider for rows,
 *      filters by `importanceScore >= threshold`, and broadcasts each survivor
 *      through `syncMemory()` to every peer with an OPEN socket.
 *   3. The provider is registered by `setMemoryProvider(...)`
 *      (federation.ts:33), the ONLY way `getMemoriesForSync` becomes
 *      non-null.
 *
 * Part 3 is the defect. `ws_server.ts` — the single production construction
 * site of `FederationManager` (ws_server.ts:56) — wires `setRelayHandler`
 * and `setMemorySyncHandler` and then calls `.start()`, but it never calls
 * `setMemoryProvider`. Repo-wide, `setMemoryProvider` has ZERO production
 * call sites; the only hits are the export in federation.ts and the test
 * file that exercises it. So `getMemoriesForSync` stays `null` in every real
 * hub, `syncImportantMemories` returns on its first line
 * (`if (!this.getMemoriesForSync) return;`), and the interval fires into an
 * empty function forever.
 *
 * The consequence is silent and total: a hub configured with
 * `federationSync: { enabled: true, syncIntervalMs: 300000 }` logs
 * "Periodic memory sync enabled (interval: 300000ms, threshold: 7)" on every
 * boot, which reads as a working feature, and sends NOTHING. No memory ever
 * crosses the federation wire on a timer.
 *
 * `federation_sync_important_memories.test.ts` (07-14) already covers
 * `syncImportantMemories` thoroughly — 8 cases driving it directly through
 * `setMemoryProvider` + a bracket-notation call. That is precisely why the gap
 * is invisible: the engine is tested with a provider the product never
 * registers. This suite drives the REAL entry point (`start()`), and asserts
 * on the provider's registration state rather than on the engine it feeds.
 *
 * Two further defects share the chain and are pinned here rather than fixed,
 * because each repair is a behaviour decision for father:
 *
 *   F2 — `db.setMemory` never writes `importance_score`. The column exists
 *   (`db.ts:546` REAL NOT NULL DEFAULT 5.0) and `mapMemoryRow`
 *   (db.ts:182-193) never sets `importanceScore` on the mapped object either,
 *   so any row handed to the engine has `importanceScore === undefined`.
 *   With the default threshold of 7.0, `undefined >= 7.0` is false for every
 *   row, so even IF a provider were registered, a provider returning plain
 *   `DBMemory[]` would sync zero memories. Only the extraction path
 *   (db.ts:948 / 1573) ever computes an importance, and it computes it in a
 *   query, not into the row.
 *
 *   F3 — `maxSyncPerRound` (`types.ts:28`, "max memories per sync round
 *   (default: 50)") has ZERO readers anywhere in src/. `syncImportantMemories`
 *   iterates every survivor with no cap. So the config field advertises a
 *   bound the engine does not enforce.
 *
 *   F4 — `start()` (federation.ts:43-51) returns on its third line when
 *   `federationPeers` is empty, BEFORE reaching the `startPeriodicSync()`
 *   call on line 50. A solo hub with `federationSync: { enabled: true }`
 *   configured therefore arms no timer and logs nothing — the periodic-sync
 *   log line this suite keys on is unreachable in the single-hub topology
 *   that most deployments actually run. This is defensible as intent
 *   (nothing to sync with) but it means "enabled" is doubly inert: once for
 *   lack of a provider, once for lack of peers, and the two conditions are
 *   independent.
 *
 * To reach the timer at all, a test must supply a peer. Arms (2)-(5) do so
 * with one unreachable peer, so `connectToPeer` opens a socket that never
 * completes; `startPeriodicSync` still runs, and `syncMemory` still logs its
 * per-key line with a zero-peer map.
 *
 * Arm (0) is a source-text pin on the production registration site and MUST
 * go red on any mutation there. Arms (1)-(6b) drive the real `start()` path.
 * Arm (7) is the negative control: a pure rename of a local binding, zero
 * behaviour change, which must SURVIVE the whole file.
 *
 * All repairs are father-gated. Which is the right repair for F1 is a
 * product decision with opposite answers: wire `setMemoryProvider` in
 * ws_server.ts (making the timer live, and thereby making F2 reachable and
 * urgent), or drop the periodic-sync machinery until F2 has an answer (making
 * the "enabled" log line a lie that must also go). This suite pins current
 * behaviour so that either choice turns it RED on purpose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { FederationManager } from '../src/federation.js';

const FED = new URL('../src/federation.ts', import.meta.url);
const WS = new URL('../src/ws_server.ts', import.meta.url);

/** A minimal production-shaped Config for a hub with federationSync armed.
 *  One unreachable peer is supplied so `start()` reaches `startPeriodicSync()`;
 *  F4 pins the case where that peer is absent. */
function config(over: Record<string, unknown> = {}) {
  return {
    port: 8788, restPort: 8789, host: '127.0.0.1', dataDir: '/tmp/r479',
    authToken: 'test-token', hubId: 'hub-a',
    federationPeers: [{ hubId: 'peer-dead', wsUrl: 'ws://127.0.0.1:1', federationToken: 'x' }],
    federationSync: { enabled: true, syncIntervalMs: 1000 },
    ...over,
  } as any;
}

beforeEach(() => {
  // The unreachable peer makes connectToPeer retry for the life of the
  // process. That stderr is real and correct (a peer genuinely is down), but
  // it is not what these arms measure, so it is silenced rather than
  // tolerated.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('R479 — periodic federation sync is armed but has no provider', () => {
  it('arm 0: the production construction site never registers a memory provider', () => {
    // SOURCE-TEXT PIN, not an outcome probe. If someone wires
    // setMemoryProvider into ws_server.ts, this arm goes red on purpose and
    // the round's finding is resolved by hand.
    const ws = readFileSync(WS, 'utf-8');
    expect(ws).not.toMatch(/setMemoryProvider\s*\(/);
    // ...and it does register the other two federation handlers, so the pin
    // is anchored on the specific missing one rather than on a file that
    // wires nothing at all.
    expect(ws).toMatch(/setRelayHandler\s*\(/);
    expect(ws).toMatch(/setMemorySyncHandler\s*\(/);
  });

  it('arm 1: the provider slot stays null after a real start() with sync armed', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());
    m.start();
    // The private slot is the observable: syncImportantMemories reads
    // exactly this, and its first statement is the early return.
    expect((m as any).getMemoriesForSync).toBeNull();
    // ...and the interval really was armed, so this is not "nothing
    // happened because nothing started".
    expect((m as any).syncInterval).not.toBeNull();
    m.stop();
  });

  it('arm 1b: F4 — a solo hub (no peers) arms no timer and logs nothing at all', () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config({ federationPeers: [] }));
    m.start();
    // start() returns on the "No peers configured" branch, before
    // startPeriodicSync() is ever called. `enabled: true` is honoured by
    // nobody.
    expect((m as any).syncInterval).toBeNull();
    const lines = log.mock.calls.map(c => c.join(' '));
    expect(lines.filter(l => l.includes('Periodic memory sync enabled')).length).toBe(0);
    expect(lines.filter(l => l.includes('No peers configured')).length).toBe(1);
  });

  it('arm 2: the timer fires and announces itself, yet sends zero memory_sync messages', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());
    // No provider registered — this is exactly what production does.
    m.start();
    await vi.advanceTimersByTimeAsync(60_000);

    const lines = log.mock.calls.map(c => c.join(' '));
    // The announce line a user reads as proof the feature is live.
    expect(lines.some(l => l.includes('Periodic memory sync enabled (interval: 1000ms'))).toBe(true);
    // No peer ever connects, so syncMemory would emit "Synced memory '<key>'
    // to N peers" with N=0. It never does: the engine early-returned on
    // `!this.getMemoriesForSync` sixty times.
    expect(lines.filter(l => l.includes('Synced memory')).length).toBe(0);
    expect(lines.filter(l => l.includes('Periodic sync:')).length).toBe(0);
    m.stop();
  });

  it('arm 2b: a null provider tick is SILENT — no error, no sync, no summary', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());
    m.start();   // no provider — the production state
    await vi.advanceTimersByTimeAsync(10_000);

    const errLines = err.mock.calls.map(c => c.join(' '));
    // The early return is a CLEAN no-op: ten ticks, zero errors. If the guard
    // is ever changed to call through, every tick throws a TypeError and the
    // interval's .catch() routes it to fedError — this arm is what makes that
    // difference observable. Without it the suite cannot tell "the guard
    // worked" from "the guard is gone and something else is eating the throw".
    expect(errLines.filter(l => l.includes('Periodic sync error:')).length).toBe(0);
    expect(errLines.filter(l => l.includes('is not a function')).length).toBe(0);
    // ...and the other two channels stay silent for the same reason.
    const lines = log.mock.calls.map(c => c.join(' '));
    expect(lines.filter(l => l.includes('Synced memory')).length).toBe(0);
    expect(lines.filter(l => l.includes('Periodic sync:')).length).toBe(0);
    m.stop();
  });

  it('arm 3: with a provider registered the same timer does drive the engine (the gate is not "start() is broken")', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());
    m.setMemoryProvider(async () => ([
      { key: 'k1', value: 'v1', tags: ['t'], importanceScore: 9 },
      { key: 'low', value: 'v2', tags: ['t'], importanceScore: 2 },
    ] as any));
    m.start();
    await vi.advanceTimersByTimeAsync(60_000);

    const lines = log.mock.calls.map(c => c.join(' '));
    // 60 ticks at 1000ms, one survivor each tick.
    expect(lines.filter(l => l.includes("Synced memory 'k1'")).length).toBe(60);
    expect(lines.filter(l => l.includes('Periodic sync: 1/2 memories above threshold 7')).length).toBe(60);
    expect(lines.filter(l => l.includes("'low'")).length).toBe(0);
    m.stop();
  });

  it('arm 4: F2 — a provider returning plain DBMemory[] syncs nothing, because the rows carry no importanceScore', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());

    // Exactly what db.getAllMemory() hands back. mapMemoryRow (db.ts:182-193)
    // sets key/value/tags/ttl/expireAt/updatedAt/updatedBy/federated/sourceHub
    // and NOT importanceScore — and db.setMemory never writes the column, so
    // every real row is 5.0 at rest and undefined in the mapped object.
    const dbRow = {
      key: 'db-row', value: 'v', tags: ['x'], ttl: 0, expireAt: 0,
      updatedAt: 1, updatedBy: 'u', federated: false, sourceHub: undefined,
    };
    m.setMemoryProvider(async () => [dbRow] as any);
    m.start();
    await vi.advanceTimersByTimeAsync(10_000);

    const lines = log.mock.calls.map(c => c.join(' '));
    expect(lines.filter(l => l.includes("Synced memory 'db-row'")).length).toBe(0);
    expect(lines.filter(l => l.includes('Periodic sync:')).length).toBe(0);
    m.stop();
  });

  it('arm 5: F2 boundary — undefined never passes the default threshold 7.0, and 5.0 does not either', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mk = async () => {
      const m = new FederationManager(config());
      return m;
    };
    // Case A: the mapped-row shape (importanceScore absent).
    const a = await mk();
    a.setMemoryProvider(async () => ([{ key: 'u', value: 'v', tags: [], updatedBy: 'x' }] as any));
    await (a as any).syncImportantMemories();
    // Case B: a row that HAS the field at its real database default of 5.0.
    const b = await mk();
    b.setMemoryProvider(async () => ([{ key: 'f', value: 'v', tags: [], importanceScore: 5.0 }] as any));
    await (b as any).syncImportantMemories();

    const lines = log.mock.calls.map(c => c.join(' '));
    // Neither shape reaches the wire, for different reasons: A because the
    // comparison is undefined >= 7.0, B because 5.0 < 7.0.
    expect(lines.filter(l => l.includes("Synced memory 'u'")).length).toBe(0);
    expect(lines.filter(l => l.includes("Synced memory 'f'")).length).toBe(0);
    expect(lines.filter(l => l.includes('Periodic sync:')).length).toBe(0);
  });

  it('arm 6: F3 — maxSyncPerRound is declared in Config and read by nothing in src/', () => {
    const fed = readFileSync(FED, 'utf-8');
    const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf-8');
    // Declared, with a documented default of 50.
    expect(types).toMatch(/maxSyncPerRound\?:\s*number/);
    expect(types).toMatch(/maxSyncPerRound\?:\s*number;[\s\S]{0,80}default:\s*50/);
    // The engine iterates every survivor — measured, not asserted: the ONLY
    // mention in federation.ts is the Config type import, and the loop has
    // no slice and no break.
    expect(fed).not.toMatch(/maxSyncPerRound/);
    expect(fed).toMatch(/for \(const mem of important\)/);
    // ...and no suite anywhere pins a cap, so the field has never been
    // observable. A 50-cap repair will turn this arm red on purpose.
    expect(fed).not.toMatch(/\.slice\(0,\s*(?:this\.config|.*maxSync)/);
  });

  it('arm 6b: a provider that REJECTS reaches the "Periodic sync error:" channel', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());
    m.setMemoryProvider(async () => { throw new Error('provider exploded'); });
    m.start();
    await vi.advanceTimersByTimeAsync(3_000);

    const errLines = err.mock.calls.map(c => c.join(' '));
    // The interval's own .catch() (federation.ts:70-72) routes a thrown
    // provider to fedError. Without this arm the error channel has NO
    // observation in the suite, and M6 (the early-return guard inverted) can
    // survive 9/9 by turning every tick into a swallowed TypeError.
    expect(errLines.filter(l => l.includes('Periodic sync error:'))).toHaveLength(3);
    expect(errLines.filter(l => l.includes('provider exploded'))).toHaveLength(3);
    // The announce line still fired, so the timer was live for all three.
    expect(log.mock.calls.map(c => c.join(' ')).filter(l => l.includes('Periodic memory sync enabled'))).toHaveLength(1);
    m.stop();
  });

  it('arm 7: NEGATIVE CONTROL — a pure rename of a local binding survives the whole file', async () => {
    // Zero behaviour change: the filter callback is routed through an intermediate
    // used identically. If this arm ever dies, the suite has started pinning
    // spelling instead of outcomes, and every other kill in the matrix is
    // suspect.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new FederationManager(config());
    m.setMemoryProvider(async () => ([
      { key: 'a', value: '1', tags: [], importanceScore: 8 },
      { key: 'b', value: '2', tags: [], importanceScore: 3 },
    ] as any));
    await (m as any).syncImportantMemories();
    const lines = log.mock.calls.map(c => c.join(' '));
    expect(lines.filter(l => l.includes("Synced memory 'a'")).length).toBe(1);
    expect(lines.filter(l => l.includes("Synced memory 'b'")).length).toBe(0);
    expect(lines.filter(l => l.includes('Periodic sync: 1/2')).length).toBe(1);
  });
});
