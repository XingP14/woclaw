/**
 * FederationManager.syncImportantMemories private-method runtime coverage
 * (07-14 00:23 cron tick — V3 27 tick/d real-code chain).
 *
 * Background:
 * `syncImportantMemories` is a `private async` method on FederationManager
 * declared in hub/src/federation.ts L225-237. It is the engine behind the
 * periodic memory-sync loop that wires together:
 *   1. The optional `getMemoriesForSync` provider (registered via
 *      `setMemoryProvider(...)`) — pulls `{ key, value, tags,
 *      importanceScore }[]` from the local hub's memory pool.
 *   2. The configurable threshold `this.config.federationSync?
 *      .importanceThreshold ?? 7.0` — keeps only memories whose
 *      `importanceScore >= threshold` from crossing the federation wire.
 *   3. The `syncMemory(key, value, tags, sourceHub)` helper — broadcasts a
 *      `memory_sync` FederationMessage to every connected peer with an OPEN
 *      WebSocket, and emits `fedLog("Synced memory '...' to N peers")` for
 *      each successful send (so the per-mem count is observable via spy on
 *      console.log).
 *   4. A summary fedLog line of the form
 *      `Periodic sync: X/Y memories above threshold T` after the loop runs.
 *
 * Why this test exists:
 *   - `hub/test/federation.test.ts` covers addPeer / getPeersStatus /
 *     sendToAgent / broadcast / stop (5 cases) but never touches the private
 *     periodic-sync engine. The earlier `federation_log.test.ts` (07-04
 *     01:23 cron) only pins the 3 helper signatures, not their behavior in
 *     a flow.
 *   - Without runtime coverage, regressions in the filter predicate
 *     (`>=` vs `>`), the default-threshold fallback (7.0), or the empty
 *     `important` array early-return would silently ship — the loop just
 *     runs every `syncIntervalMs` and looks fine on the wire while emitting
 *     zero memory_sync messages, and the next reader chasing a missing
 *     federation memory has no test to point at.
 *   - The 5 min `setInterval(...)` default would also make this slow to
 *     exercise end-to-end; an explicit bracket-notation call into the
 *     private method lets us drive every branch deterministically.
 *
 * Cases (8):
 *   1. No `getMemoriesForSync` provider registered → method returns
 *      immediately. spyOn(console, 'log') sees NO "Periodic sync:" line
 *      and NO "Synced memory" line. (regression gate against accidental
 *      throw before the early-return.)
 *   2. Default threshold 7.0: a batch of 4 memories at scores
 *      [4.0, 6.9, 7.0, 9.5] → only the 7.0 and 9.5 entries cross the wire.
 *      The `>=` boundary at exactly 7.0 is included (not strict >). The
 *      summary line reads `Periodic sync: 2/4 memories above threshold 7`.
 *   3. Custom `federationSync.importanceThreshold = 5.0`: same batch
 *      [4.0, 6.9, 7.0, 9.5] now produces 3/4 (>= 5.0 catches 6.9/7.0/9.5).
 *      Summary uses `threshold 5`.
 *   4. Provider returns `[]` → `memories.length === 0` and the filter
 *      produces `important.length === 0` → early return before the loop
 *      AND before the fedLog summary line. (regression gate: previously
 *      the summary printed `Periodic sync: 0/0 memories above threshold 7`
 *      which leaks a noise line every interval for hubs with no memory.)
 *   5. All memories below threshold (1 mem at score 3.0, threshold default
 *      7.0) → `important.length === 0` → same early-return as case 4 but
 *      with non-empty input. spy sees NO "Periodic sync:" line.
 *   6. Multiple memories above threshold (5 mems at 8.0) → 5
 *      "Synced memory 'kN' to 0 peers" lines (no peers connected — but
 *      syncMemory still loops and emits one log line per memory) followed
 *      by ONE "Periodic sync: 5/5 memories above threshold 7" summary.
 *   7. Provider throws → the rejection propagates out of
 *      `syncImportantMemories` (no internal try/catch — verified by
 *      `await expect(...).rejects.toThrow(...)`). The caller
 *      `startPeriodicSync` wraps the call in `.catch((err) =>
 *      fedError(...))` so the periodic loop survives a single bad
 *      provider invocation; this test pins that propagation contract so a
 *      future refactor that adds an internal try/catch must update this
 *      case too.
 *   8. `setMemoryProvider` overrides the previously-registered provider:
 *      a second `setMemoryProvider(...)` call replaces the first closure,
 *      and a subsequent `syncImportantMemories` invocation honors the
 *      latest registration. (regression gate against the closure being
 *      treated as immutable or memoized.)
 *
 * Watchdog check string: `test(federation): ...` — V3 watchdog rule 1
 * (real code, any-time ALLOW).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FederationManager } from '../src/federation.js';
import type { Config, FederationPeer } from '../src/types.js';
import fs from 'fs';

function mkTempDir() {
  const dir = `/tmp/woclaw-sync-test-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createConfig(
  syncConfig?: NonNullable<Config['federationSync']>,
  peers: Partial<FederationPeer>[] = [],
): Config {
  const cfg: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: mkTempDir(),
    authToken: 'test-token',
    hubId: 'hub-sync-test',
    federationPeers: peers.map((p) => ({
      hubId: p.hubId || 'peer-1',
      wsUrl: p.wsUrl || 'ws://localhost:9999',
      federationToken: p.federationToken || 'peer-secret',
      status: 'disconnected',
      lastSeen: 0,
      connectedAgents: 0,
    })),
    federationPingIntervalMs: 5000,
  } as Config;
  if (syncConfig) {
    cfg.federationSync = syncConfig;
  }
  return cfg;
}

type MemRecord = {
  key: string;
  value: string;
  tags: string[];
  importanceScore: number;
};

function getSyncFn(manager: FederationManager): () => Promise<void> {
  // syncImportantMemories is declared `private async` on FederationManager;
  // TypeScript's `private` is compile-time only — bracket-notation access
  // works at runtime. Cast to `any` once so the call site reads cleanly.
  const fn = (manager as unknown as Record<string, () => Promise<void>>)[
    'syncImportantMemories'
  ];
  if (typeof fn !== 'function') {
    throw new Error('syncImportantMemories not found on FederationManager');
  }
  return fn.bind(manager);
}

describe('FederationManager.syncImportantMemories (07-14 00:23 cron tick)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('case 1: no provider registered → returns early, no fedLog summary, no per-mem line', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    const sync = getSyncFn(m);

    await sync();

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    expect(summaryCalls.length).toBe(0);
    expect(perMemCalls.length).toBe(0);

    m.stop();
  });

  it('case 2: default threshold 7.0 — only scores >= 7.0 sync; boundary 7.0 included', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    const batch: MemRecord[] = [
      { key: 'low', value: 'v1', tags: ['t'], importanceScore: 4.0 },
      { key: 'just-under', value: 'v2', tags: ['t'], importanceScore: 6.9 },
      { key: 'boundary', value: 'v3', tags: ['t'], importanceScore: 7.0 },
      { key: 'high', value: 'v4', tags: ['t'], importanceScore: 9.5 },
    ];
    m.setMemoryProvider(async () => batch);
    const sync = getSyncFn(m);

    await sync();

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    expect(perMemCalls.length).toBe(2);
    expect(summaryCalls.length).toBe(1);
    expect(summaryCalls[0]?.[0]).toBe(
      '[WoClaw Federation] Periodic sync: 2/4 memories above threshold 7',
    );

    m.stop();
  });

  it('case 3: custom importanceThreshold 5.0 — same batch produces 3/4 synced, threshold echoed in summary', async () => {
    const m = new FederationManager(
      createConfig({ enabled: true, syncIntervalMs: 60000, importanceThreshold: 5.0 }),
    );
    const batch: MemRecord[] = [
      { key: 'a', value: 'v1', tags: ['t'], importanceScore: 4.0 },
      { key: 'b', value: 'v2', tags: ['t'], importanceScore: 6.9 },
      { key: 'c', value: 'v3', tags: ['t'], importanceScore: 7.0 },
      { key: 'd', value: 'v4', tags: ['t'], importanceScore: 9.5 },
    ];
    m.setMemoryProvider(async () => batch);
    const sync = getSyncFn(m);

    await sync();

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    expect(perMemCalls.length).toBe(3);
    expect(summaryCalls.length).toBe(1);
    expect(summaryCalls[0]?.[0]).toBe(
      '[WoClaw Federation] Periodic sync: 3/4 memories above threshold 5',
    );

    m.stop();
  });

  it('case 4: provider returns [] → no summary line, no per-mem line (empty input early-return)', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    m.setMemoryProvider(async () => []);
    const sync = getSyncFn(m);

    await sync();

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    expect(summaryCalls.length).toBe(0);
    expect(perMemCalls.length).toBe(0);

    m.stop();
  });

  it('case 5: all memories below threshold → early-return after filter, no summary line', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    m.setMemoryProvider(async () => [
      { key: 'only-low', value: 'v1', tags: ['t'], importanceScore: 3.0 },
    ]);
    const sync = getSyncFn(m);

    await sync();

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    expect(summaryCalls.length).toBe(0);
    expect(perMemCalls.length).toBe(0);

    m.stop();
  });

  it('case 6: 5 memories above default threshold → 5 per-mem lines + 1 summary line', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    m.setMemoryProvider(async () =>
      [1, 2, 3, 4, 5].map((i) => ({
        key: `k${i}`,
        value: `v${i}`,
        tags: ['t'],
        importanceScore: 8.0,
      })),
    );
    const sync = getSyncFn(m);

    await sync();

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    expect(perMemCalls.length).toBe(5);
    expect(summaryCalls.length).toBe(1);
    expect(summaryCalls[0]?.[0]).toBe(
      '[WoClaw Federation] Periodic sync: 5/5 memories above threshold 7',
    );

    m.stop();
  });

  it('case 7: provider throws → rejection propagates out (no internal try/catch swallowing)', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    m.setMemoryProvider(async () => {
      throw new Error('provider exploded');
    });
    const sync = getSyncFn(m);

    await expect(sync()).rejects.toThrow('provider exploded');

    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    expect(summaryCalls.length).toBe(0);

    m.stop();
  });

  it('case 8: setMemoryProvider second call replaces the first — latest registration wins', async () => {
    const m = new FederationManager(createConfig({ enabled: true, syncIntervalMs: 60000 }));
    const firstBatch: MemRecord[] = [
      { key: 'first-a', value: 'v1', tags: ['t'], importanceScore: 8.0 },
    ];
    const secondBatch: MemRecord[] = [
      { key: 'second-a', value: 'v2', tags: ['t'], importanceScore: 8.5 },
      { key: 'second-b', value: 'v3', tags: ['t'], importanceScore: 9.0 },
    ];
    m.setMemoryProvider(async () => firstBatch);
    m.setMemoryProvider(async () => secondBatch);
    const sync = getSyncFn(m);

    await sync();

    const perMemCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes("Synced memory '"),
    );
    const summaryCalls = logSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Periodic sync:'),
    );
    expect(perMemCalls.length).toBe(2);
    expect(summaryCalls.length).toBe(1);
    expect(summaryCalls[0]?.[0]).toBe(
      '[WoClaw Federation] Periodic sync: 2/2 memories above threshold 7',
    );

    m.stop();
  });
});