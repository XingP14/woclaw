/**
 * R496 — the graph is a copy of the memory, and the copy does not survive a restart.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74). R441–R494 were 40+ consecutive in-cluster rounds, and
 * the last four (R489/R491/R493/R494) all lived on the CREDENTIAL plane:
 *
 *   R454 — MECHANISM plane: how is the token generated, compared, rotated?
 *   R489 — VALUE plane:      is this specific literal public?
 *   R491 — SCOPE plane:      which operations does the credential gate?
 *   R494 — SUBJECT plane:    which agent is the caller?
 *
 * This round opens a plane none of those touched: the DURABILITY PLANE —
 * *which parts of what the hub knows survive the hub being restarted?*
 *
 *   EXTERNAL LEG (controls first, R404-M1):
 *     HN Algolia CTRL `agent` = 532,188 / `LLM` = 54,273 / `AI agent` = 20,635
 *     HN precision (60d): `agent memory durability crash` = 0 ·
 *       `sqlite wal crash consistency agent` = 0 ·
 *       `agent durable write fsync` = 0 ·
 *       `agent persistence durability guarantee` = 0 ·
 *       `memory store torn write agent` = 1 (unrelated Show HN) ·
 *       `write ahead log agent memory` = 1 (unrelated Show HN)
 *     GH CTRL `agent` = 2,017,670+ ; GH precision `litestream sqlite replication`
 *       = 0
 *
 *   NOT reported as greenfield (R449-5 / R454-4 / R475-3 discipline):
 *   SQLite WAL, `db.backup()`, Litestream, WAL-G, restic, ZFS/Btrfs snapshots
 *   and MySQL's own durability knobs are all SOLVED mechanisms in adjacent
 *   fields. This is a MIGRATION GAP, not virgin territory.
 *
 * -----------------------------------------------------------------------
 * THE PLANE, stated precisely. WoClaw holds its state in two places:
 *
 *   1. `SqliteStorage` — hub/src/db.ts. On disk. `journal_mode = WAL`.
 *   2. `GraphStore`    — hub/src/graph/store.ts. **In memory.** Four `Map`s.
 *
 * `MemoryPool.write()` (hub/src/memory.ts:139-157) writes the memory into (1)
 * and then MIRRORS it into (2) via `graphStore.syncMemoryNode(...)`. The
 * mirror is the whole of (2)'s population from the memory side: nothing else
 * writes memory nodes except `POST /graph/nodes`, and nothing ever reads
 * (2) back out.
 *
 * There is no rehydration. `index.ts:58` does `new GraphStore()` on every
 * boot and never asks the database what the graph used to contain.
 *
 * -----------------------------------------------------------------------
 * WHAT IS PINNED HERE (current behaviour, RED against the defect)
 *
 *   P1  After a restart the SQL store still has the memory (value intact,
 *       updatedAt intact) and the graph store has NOTHING. The two halves of
 *       "the hub knows this memory" disagree across a restart.
 *   P2  The graph is not merely empty — it is empty in a way the API
 *       reports as a normal, healthy answer: `GET /graph/stats` returns
 *       `{"nodes":0,"edges":0}` with HTTP 200. There is no "not rebuilt"
 *       signal anywhere. A reader cannot distinguish "this hub has no graph"
 *       from "this hub just started".
 *   P3  The mirror is one-directional and lossy in the other direction too:
 *       a graph node created through `POST /graph/nodes` (an operator's
 *       manual annotation) is ALSO in-memory-only, so a restart deletes
 *       hand-made annotations with no record that they ever existed.
 *   P4  `docs/README.md:63` and `docs/README_zh.md:239` advertise Graph
 *       Memory as "temporal/entity/causal/semantic graph relationships".
 *       The production write path creates ONLY `entity` edges. `temporal`
 *       and `causal` have no producer in production code at all — they can
 *       only appear via `POST /graph/edges`. And because the graph is
 *       rebuilt from nothing, the edge types that DO exist are also lost.
 *   P5  The extraction engine — the documented source of "auto graph
 *       association" (`docs/ROADMAP.md` M7-GN1) — is never constructed at
 *       boot and `setGraphStore()` has no caller, so the graph's population
 *       path is closed before the graph is even populated.
 *   P6  The SQLite side has its own durability gap: the store runs in WAL
 *       mode and NOTHING in the codebase ever calls `wal_checkpoint()`. The
 *       WAL is only drained by SQLite's own `wal_autocheckpoint` at 1000
 *       pages (~4 MB). An operator who "backs up the database" by copying
 *       `woclaw.sqlite` therefore copies a file that can be missing
 *       recently-committed rows. Measured: 901 committed rows -> a
 *       file-only copy holds 793.
 *
 * -----------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE. This does not assert that the graph
 * SHOULD be durable — that is a design decision (rehydrate from SQL on
 * boot? persist the graph? drop the graph?). It asserts only what the code
 * does: the mirror exists, it is one-directional, it is in-memory only, and
 * nothing rebuilds it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const HERE = dirname(new URL(import.meta.url).pathname);
const SRC = join(HERE, '..', 'src');

function makeCfg(dir: string): Config {
  return {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    storage: { type: 'sqlite', sqlitePath: join(dir, 'woclaw.sqlite') },
    authToken: 'r496-token',
  } as unknown as Config;
}

/** Boot-equivalent construction: a fresh DB handle, a fresh MemoryPool, and
 *  a fresh GraphStore — exactly what index.ts:52-61 builds on every boot. */
async function bootLike(dir: string) {
  const db = new ClawDB(makeCfg(dir));
  await (db as unknown as { ensureReady?: () => Promise<void> }).ensureReady?.();
  const pool = new MemoryPool(db);
  const graph = new GraphStore();
  pool.graphStore = graph;
  return { db, pool, graph };
}

// ────────────────────────────────────────────────────────────────────────────
// THE BOOT SEQUENCE IS DERIVED, NOT HAND-COPIED.
//
// R496's first draft built its "boot" out of a hand-written `bootLike()` that
// did `new GraphStore()` and attached it to a MemoryPool — a COPY of what
// index.ts does. The mutation matrix caught the consequence: M1 (the TRUE
// REPAIR — rehydrate the graph from SQL at boot, injected into index.ts) was
// SURVIVED by the suite. The suite was watching its own copy, not the real
// boot.
//
// That is R493-M493-2 exactly: "a hand-copied extractor is a key that opens a
// door, but not necessarily THE door." A suite that hand-copies the boot
// sequence cannot see a repair to the boot sequence.
//
// So the boot is DERIVED FROM index.ts itself: the source is read, the
// `new GraphStore()` line is located, and the rehydration is observed by
// booting the REAL process. Below, `bootReal()` spawns the actual entrypoint.
// ────────────────────────────────────────────────────────────────────────────

/** Spawn the REAL hub entrypoint and return a handle.
 *
 *  TWO HARNESS FACTS, both learned the hard way this round:
 *
 *  (a) tsx FORKS, so killing only `child` kills the wrapper and orphans the
 *      listener, which then holds its port for every later boot (R487-4).
 *      The whole group is killed with a negative pid.
 *
 *  (b) The hub binds port 8084 for the Web UI whenever `join(cwd, 'public')`
 *      exists. Vitest runs test FILES IN PARALLEL, and `r487` also boots a
 *      real hub and asserts its output contains no `EADDRINUSE` — so a suite
 *      that boots a hub from the repo root collides with r487 and turns
 *      r487's arm red for a reason that has nothing to do with r487.
 *      Fix: spawn with `cwd` set to a scratch directory, so `process.cwd()`
 *      has no `public/` child and the hub never binds 8084. The entrypoint
 *      is passed as an ABSOLUTE path, so the cwd does not affect module
 *      resolution.
 */
function bootReal(dataDir: string, port: number): { out: () => string; stop: () => void } {
  let stdout = '';
  const child = spawn(
    join(HERE, '..', 'node_modules', '.bin', 'tsx'),
    [join(HERE, '..', 'src', 'index.ts')],
    {
      cwd: dataDir,                       // no `public/` here => no 8084 bind
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        SQLITE_PATH: join(dataDir, 'woclaw.sqlite'),
        PORT: String(port),
        REST_PORT: String(port + 1),
        HOST: '127.0.0.1',
        AUTH_TOKEN: 'r496-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stdout += d; });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
  };
  return { out: () => stdout, stop };
}

/** Wait for the REST server to answer, then return its JSON.
 *
 *  The wait is READINESS-based, not a fixed sleep. Under the full suite the
 *  tsx transform+boot can take far longer than it does in isolation, and a
 *  fixed budget turns a load-dependent timing difference into a red arm
 *  (R482-10: a fixed sleep on a network arm is a coin flip). */
async function restJson(port: number, path: string, method = 'GET', body?: unknown, attempts = 240): Promise<any> {
  const url = `http://127.0.0.1:${port}${path}`;
  let last: any = { status: 0, error: 'no response' };
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer r496-token' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      try { last = { status: res.status, json: JSON.parse(text) }; } catch { last = { status: res.status, text }; }
      if (res.status > 0) return last;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  return last;
}

describe('R496 — the graph is a copy of the memory, and the copy does not survive a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r496-'));

  afterAll(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  // ── P1: the split, measured across a REAL restart ─────────────────────
  //
  // This arm boots the REAL entrypoint (`src/index.ts`) twice against the
  // same data dir. It is the arm that the M1 mutation must kill: M1 injects
  // a rehydration loop into index.ts, and only a suite that boots index.ts
  // can see it.
  it('P1 after a REAL hub restart the SQL store still holds the memory and the graph store is empty', async () => {
    const liveDir = mkdtempSync(join(tmpdir(), 'r496-live-'));
    const port = 19100 + (process.pid % 300);

    // ── boot 1: write through the real REST API ──
    // NOTE: bootReal() takes the WS port; the REST server binds port+1.
    // (Getting this wrong is the R482-10 shape: a probe that fails for a
    // harness reason and looks like a product failure.)
    const h1 = bootReal(liveDir, port);
    const w = await restJson(port + 1, '/memory', 'POST', { key: 'r496:e2e:key', value: 'durable-value', tags: ['topic:r496'] });
    if (w.status !== 200) {
      const log = h1.out();
      h1.stop();
      throw new Error(`boot1 write failed (status=${w.status}); boot output:\n${log.slice(0, 1500)}`);
    }
    expect(w.json?.value).toBe('durable-value');

    const g1 = await restJson(port + 1, '/graph/nodes?type=memory');
    expect(g1.status).toBe(200);
    expect(g1.json?.count).toBe(1);                 // the mirror works
    expect(g1.json?.nodes?.[0]?.label).toBe('r496:e2e:key');

    h1.stop();                                       // kill the group

    // ── boot 2: a genuinely fresh process against the same data dir ──
    const port2 = port + 10;
    const h2 = bootReal(liveDir, port2);

    const m2 = await restJson(port2 + 1, '/memory/r496:e2e:key');
    expect(m2.status).toBe(200);
    expect(m2.json?.value).toBe('durable-value');    // the durable half survived

    const g2 = await restJson(port2 + 1, '/graph/nodes?type=memory');
    expect(g2.status).toBe(200);
    expect(g2.json?.count).toBe(0);                 // the mirrored half did NOT

    const s2 = await restJson(port2 + 1, '/graph/stats');
    expect(s2.status).toBe(200);
    expect(s2.json?.nodes).toBe(0);

    h2.stop();
    rmSync(liveDir, { recursive: true, force: true });
  }, 180000);

  // ── P2: the API reports the empty graph as a healthy answer ───────────
  it('P2 the empty graph is reported as a normal healthy answer — there is no "not rebuilt" signal', async () => {
    const { db, graph } = await bootLike(dir);
    const stats = graph.getStats();
    expect(stats.nodes).toBe(0);
    expect(stats.edges).toBe(0);
    // The stats shape has exactly four edge-type counters and no
    // "rehydrated" / "stale" / "sinceBoot" field to carry the distinction.
    expect(Object.keys(stats.byType.edges).sort()).toEqual(['causal', 'entity', 'semantic', 'temporal']);
    expect(Object.keys(stats)).not.toContain('rehydrated');
    await db.close();
  });

  // ── P3: the mirror is one-directional in BOTH directions ─────────────
  it('P3 an operator-annotated graph node is also in-memory only — it disappears on restart with no record', async () => {
    const first = await bootLike(dir);
    // a node created the way the REST API creates one
    first.graph.addNode({ type: 'memory', label: 'r496:manual', metadata: { value: 'hand-written' } });
    expect(first.graph.getNodes('memory').map((n) => n.label)).toContain('r496:manual');
    await first.db.close();

    const second = await bootLike(dir);
    expect(second.graph.getNodes('memory').map((n) => n.label)).not.toContain('r496:manual');
    // and nothing anywhere records that it existed
    const allMem = await second.db.getAllMemory();
    expect(allMem.map((m) => m.key)).not.toContain('r496:manual');
    await second.db.close();
  });

  // ── P4: the advertised edge types vs the produced edge types ─────────
  it('P4 the production write path creates ONLY entity edges — temporal and causal have no producer in production code', async () => {
    const { db, pool, graph } = await bootLike(dir);
    await pool.write('r496:a', 'alpha', 'agent-1', ['topic:ops'], 0);
    await pool.write('r496:b', 'bravo', 'agent-2', ['topic:ops'], 0);
    await pool.write('r496:c', 'charlie', 'agent-3', [], 0);

    const edges = graph.getEdges({});
    const byType: Record<string, number> = {};
    for (const e of edges) byType[e.type] = (byType[e.type] || 0) + 1;

    expect(byType.entity).toBeGreaterThan(0);
    expect(byType.temporal ?? 0).toBe(0);
    expect(byType.causal ?? 0).toBe(0);

    // POSITIVE CONTROL: the same reader CAN see temporal/causal when they
    // exist — so the zeros above are about the producer, not the detector.
    const memNodes = graph.getNodes('memory');
    graph.addEdge({ source: memNodes[0].id, target: memNodes[1].id, type: 'temporal', metadata: {} });
    graph.addEdge({ source: memNodes[0].id, target: memNodes[1].id, type: 'causal', metadata: {} });
    const after: Record<string, number> = {};
    for (const e of graph.getEdges({})) after[e.type] = (after[e.type] || 0) + 1;
    expect(after.temporal).toBe(1);
    expect(after.causal).toBe(1);

    // the docs advertise four edge types
    const readme = readFileSync(join(SRC, '..', '..', 'docs', 'README_zh.md'), 'utf-8');
    expect(readme).toMatch(/temporal\s*\/\s*entity\s*\/\s*causal\s*\/\s*semantic/i);
    await db.close();
  });

  // ── P5: the documented population path is closed ──────────────────────
  it('P5 the extraction engine is never constructed at boot and setGraphStore() has no caller', async () => {
    const indexSrc = readFileSync(join(SRC, 'index.ts'), 'utf-8');
    const engineSrc = readFileSync(join(SRC, 'extraction', 'engine.ts'), 'utf-8');
    const schedSrc = readFileSync(join(SRC, 'scheduler.ts'), 'utf-8');

    // index.ts builds the GraphStore...
    expect(indexSrc).toMatch(/new\s+GraphStore\s*\(/);
    // ...but never constructs an ExtractionEngine, and never calls setGraphStore.
    expect(indexSrc).not.toMatch(/new\s+ExtractionEngine|createExtractionEngine/);
    expect(indexSrc).not.toMatch(/setGraphStore\s*\(/);

    // the only declaration of setGraphStore is its own declaration
    const declCount = (engineSrc.match(/setGraphStore\s*\(/g) || []).length;
    expect(declCount).toBe(1);            // the declaration only
    expect(engineSrc).toMatch(/setGraphStore\s*\(graphStore:\s*GraphStore\s*\|\s*null\)\s*:\s*void/);

    // and the scheduler's extraction-engine slot is passed `null` at boot.
    const ctorCall = indexSrc.match(/new\s+ForgettingScheduler\([^)]*\)/)?.[0] ?? '';
    expect(ctorCall).toMatch(/,\s*null\s*\)/);
    expect(schedSrc).toMatch(/extractionEngine:\s*ExtractionEngine\s*\|\s*null/);
  });

  // ── P6: the WAL backup trap on the durable half ───────────────────────
  it('P6 the store runs in WAL mode and nothing ever checkpoints it — a file-only backup can miss committed rows', async () => {
    const { db } = await bootLike(dir);
    // WAL is ON in production (db.ts:438)
    const dbFile = join(dir, 'woclaw.sqlite');
    expect(existsSync(dbFile)).toBe(true);

    // no checkpoint call anywhere in production source
    const allSrc = readdirSync(SRC, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => readFileSync(join(SRC, e.name), 'utf-8'))
      .join('\n');
    expect(allSrc).not.toMatch(/wal_checkpoint/);
    expect(allSrc).toMatch(/journal_mode\s*=\s*WAL/);

    // and the sidecars really do appear — i.e. the WAL is live, not vestigial
    const { default: Database } = await import('better-sqlite3');
    const raw = new Database(dbFile);
    expect(String(raw.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    raw.close();
    await db.close();
  });

  // ── P7: the file-only copy is measurably behind ───────────────────────
  it('P7 copying only woclaw.sqlite yields a backup that is missing committed rows', async () => {
    const work = mkdtempSync(join(tmpdir(), 'r496-wal-'));
    const { default: Database } = await import('better-sqlite3');
    const dbFile = join(work, 'woclaw.sqlite');
    const raw = new Database(dbFile);
    raw.pragma('journal_mode = WAL');
    raw.exec(`CREATE TABLE memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, tags TEXT NOT NULL,
      ttl INTEGER NOT NULL, expire_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);`);
    const ins = raw.prepare('INSERT INTO memory (key,value,tags,ttl,expire_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)');
    const tx = raw.transaction((p: { k: string; v: string; t: number }) => ins.run(p.k, p.v, '[]', 0, 0, p.t, 'agent'));

    const bulk = 'x'.repeat(8000);
    tx({ k: 'early', v: 'written-before-backup', t: 1000 });
    for (let i = 0; i < 900; i++) tx({ k: `bulk-${i}`, v: `${bulk}-${i}`, t: 2000 + i });

    const liveCount = (raw.prepare('SELECT COUNT(*) c FROM memory').get() as { c: number }).c;

    // the "obvious" backup: copy only the main database file
    const backupDir = join(work, 'backup');
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(dbFile, join(backupDir, 'woclaw.sqlite'));
    const b = new Database(join(backupDir, 'woclaw.sqlite'));
    const backupCount = (b.prepare('SELECT COUNT(*) c FROM memory').get() as { c: number }).c;
    b.close();

    // the copy that works: main + wal + shm together
    const backupDir2 = join(work, 'backup2');
    mkdirSync(backupDir2, { recursive: true });
    for (const f of readdirSync(work)) {
      if (f.startsWith('woclaw.sqlite')) copyFileSync(join(work, f), join(backupDir2, f));
    }
    const b2 = new Database(join(backupDir2, 'woclaw.sqlite'));
    const backup2Count = (b2.prepare('SELECT COUNT(*) c FROM memory').get() as { c: number }).c;
    b2.close();

    // the file-only copy is behind
    expect(backupCount).toBeLessThan(liveCount);
    // the whole-directory copy is complete
    expect(backup2Count).toBe(liveCount);
    // and the WAL sidecar really was carrying the difference
    expect(statSync(join(work, 'woclaw.sqlite-wal')).size).toBeGreaterThan(0);

    raw.close();
    rmSync(work, { recursive: true, force: true });
  });
});
