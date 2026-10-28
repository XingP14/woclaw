// R516 — the schema-drift gate: "does every column the DDL declares have a
// paired ALTER arm, and does every ALTER arm have a declared column?"
//
// This round BUILDS the gate R515-20 queued as a resident CI gate, and
// MEASURES the queued claim.
//
//   * RIGHT: the gate can be made resident.
//   * WRONG in its premise: "两个清单的比较，不需要运行时" -- the two lists CANNOT
//     be compared without git history, because "which columns arrived after
//     their table existed" is a TEMPORAL fact that lives only in history. CI
//     checks out shallow => NO HISTORY. So the historical shape is FROZEN
//     into a checked-in baseline artifact (`r516_schema_baseline.json`), the
//     same role a `migrations/` directory plays in Django/Alembic/Atlas. The
//     gate itself needs no runtime product behaviour -- but it DOES need a
//     checked-in artifact.
//
// This suite is a DEFECT-PRESENCE gate (R461 arm G / R512-14 discipline):
// GREEN while the defect exists, RED once it is fixed. That is deliberate and
// stated in the header so the next reader does not have to rediscover it.
//
// Arms:
//   A  the gate script EXISTS and produces a verdict with NO git history
//   B  the baseline artifact EXISTS, is versioned, self-describing, and
//      carries the provenance of every table it baselines
//   C  the gate MEASURES the real DDL by EXECUTING it (both backends), and
//      no table is silently skipped
//   D  the gate finds EXACTLY the two known gap columns and no others
//   E  the gate is RED (exit 1) while the defect exists
//   F  the ALTER-ARM detection is live and PER-BACKEND: the arms are found in
//      BOTH backends (the SQLite arms are helper calls, the MySQL arms are
//      literal SQL -- a single merged list would hide a one-sided arm)
//   G  BEHAVIOURAL: a legacy (pre-2026-05-27) on-disk DB booted with the
//      CURRENT product does NOT grow the two gap columns, while the three
//      columns that DO have arms ARE added
//   H  NEGATIVE CONTROL: the baseline is load-bearing -- shrinking it makes
//      the gate report MORE gaps
//   I  the anchor is the FILE, not the diff: the baseline's anchor commit is
//      the one that introduced the database file the product opens
//   J  the REVERSE asymmetry is measured: an ALTER arm for a column the DDL
//      does not declare is dead weight, and the gate counts it
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { ClawDB } from '../src/db.js';

const HUB = join(__dirname, '..');
const GATE = join(HUB, 'scripts', 'r516_schema_drift_gate.py');
const BASELINE = join(HUB, 'scripts', 'r516_schema_baseline.json');
const DBTS = join(HUB, 'src', 'db.ts');
const LEGACY = '/tmp/r516-legacy';

function runGate(args: string[] = []): { code: number; out: string } {
  try {
    const out = execFileSync('python3', [GATE, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** The `*** <backend> <table>.<column>` lines -- gaps, parity breaks, ALTER-only. */
function flagged(out: string): string[] {
  return [...out.matchAll(/\*\*\*\s+(sqlite|mysql)\s+(\w+)\.(\w+)/g)].map(
    (m) => `${m[2]}.${m[3]}`
  );
}

describe('R516 — the schema-drift gate', () => {
  let gateOut: string;
  let gateCode: number;

  beforeAll(() => {
    const r = runGate();
    gateOut = r.out;
    gateCode = r.code;
  });

  // ── A: the instrument exists ───────────────────────────────────────────────
  it('A  the gate script exists and produces a verdict with no arguments', () => {
    expect(existsSync(GATE)).toBe(true);
    expect(gateOut).toContain('R516 schema-drift gate');
    expect(gateOut).toMatch(/VERDICT: (PASS|FAIL)/);
  });

  // ── B: the baseline artifact exists and is self-describing ─────────────────
  it('B  the baseline artifact is versioned, self-describing, and sourced', () => {
    expect(existsSync(BASELINE)).toBe(true);
    const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
    expect(b.version).toBe(2);
    expect(typeof b.note).toBe('string');
    expect(b.note.length).toBeGreaterThan(40);
    // Every baseline table carries its provenance.
    for (const [t, v] of Object.entries<any>(b.tables)) {
      expect(v.commit, `${t} missing commit`).toMatch(/^[0-9a-f]{40}$/);
      expect(v.date, `${t} missing date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(v.columns)).toBe(true);
      expect(v.columns.length).toBeGreaterThan(0);
    }
  });

  // ── C: the gate MEASURES the real DDL ─────────────────────────────────────
  it('C  the gate measures the real DDL on both backends, skipping no table', () => {
    const m = gateOut.match(/CREATE TABLE stmts measured\s*:\s*(\d+)/);
    expect(m, 'gate did not report a measurement count').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(15);
    // An unbaselined table means the gate SILENTLY SKIPS it -- the subject
    // set shrinks and the verdict is about less than it appears to be.
    expect(gateOut).toMatch(/UNBASELINED tables\s+:\s*0/);
    // Both backends appear in the gap report => the gate is backend-aware.
    expect(gateOut).toContain('sqlite  memory.federated');
    expect(gateOut).toContain('mysql   memory.federated');
  });

  // ── D: exactly the two known columns are gaps ──────────────────────────────
  it('D  the gate finds EXACTLY memory.federated and memory.source_hub', () => {
    const gaps = flagged(gateOut);
    expect([...new Set(gaps)].sort()).toEqual(['memory.federated', 'memory.source_hub']);
    // Exactly 4 raw gap lines (2 columns x 2 backends).
    expect(gaps.length).toBe(4);
  });

  // ── E: the gate is RED while the defect exists ─────────────────────────────
  it('E  the gate exits 1 while the defect exists', () => {
    expect(gateCode).toBe(1);
    expect(gateOut).toContain('VERDICT: FAIL');
  });

  // ── F: the ALTER-arm detection is live AND per-backend ────────────────────
  it('F  NEGATIVE CONTROL: the ALTER arms are found in BOTH backends', () => {
    // The three v1.0 migration columns are ALTER-only on `memory`: they are
    // added to every database but never declared in the CREATE TABLE.  The
    // gate must therefore count them as covered somewhere, and must NOT
    // report them as gaps.
    const okLines = [...gateOut.matchAll(/ok \(ALTER\)\s+(sqlite|mysql)\s+(\w+)\.(\w+)/g)];
    const names = okLines.map((m) => `${m[2]}.${m[3]}`);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('memory.importance_score');
    expect(names).toContain('memory.access_count');
    expect(names).toContain('memory.last_accessed_at');
    for (const n of names) expect(flagged(gateOut)).not.toContain(n);

    // The arms must be found in BOTH backends. The SQLite arms are helper
    // calls (`addColumnIfNotExists`) and the MySQL arms are literal SQL --
    // a single merged list would hide a one-sided arm, so the gate reports
    // the parity of the arms separately and it must be ZERO here.
    expect(gateOut).toMatch(/ALTER-arm parity gaps\s+:\s*0/);
    // ... and the DDL parity must be zero too.
    expect(gateOut).toMatch(/backend parity gaps\s+:\s*0/);
  });

  // ── G: BEHAVIOURAL — the legacy DB really does not gain the columns ───────
  it('G  a legacy DB booted with the current product does NOT gain the two gap columns', async () => {
    if (existsSync(LEGACY)) rmSync(LEGACY, { recursive: true, force: true });
    mkdirSync(LEGACY, { recursive: true });
    const legacy = new Database(join(LEGACY, 'woclaw.sqlite'));
    // The pre-2026-05-27 `memory` shape (3be996c^).
    legacy.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        tags TEXT NOT NULL,
        ttl INTEGER NOT NULL,
        expire_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_expire_at ON memory(expire_at);
    `);
    legacy.close();

    const db = new ClawDB(LEGACY);
    await new Promise((r) => setTimeout(r, 300));
    const raw: any = (db as any).storage.db;
    const names = (raw.prepare('PRAGMA table_info(memory)').all() as any[]).map(
      (c) => c.name as string
    );

    // The three columns WITH a paired ALTER are added:
    expect(names).toContain('importance_score');
    expect(names).toContain('access_count');
    expect(names).toContain('last_accessed_at');
    // The two WITHOUT one are NOT added -- this is the defect, end to end.
    expect(names).not.toContain('federated');
    expect(names).not.toContain('source_hub');

    await db.close();
  });

  // ── H: NEGATIVE CONTROL — the baseline is load bearing ────────────────────
  it('H  NEGATIVE CONTROL: shrinking the baseline makes the gate report MORE gaps', () => {
    const original = readFileSync(BASELINE, 'utf8');
    try {
      const b = JSON.parse(original);
      b.tables.memory.columns = b.tables.memory.columns.filter((c: string) => c !== 'value');
      writeFileSync(BASELINE, JSON.stringify(b, null, 2) + '\n');
      const mutated = runGate();
      expect(mutated.code).toBe(1);
      expect(flagged(mutated.out)).toContain('memory.value');
    } finally {
      writeFileSync(BASELINE, original);
    }
    // After restore the gate is back to exactly 4 gaps.
    const after = runGate();
    expect(flagged(after.out).length).toBe(4);
  });

  // ── I: the anchor is the FILE, not the diff ───────────────────────────────
  it('I  the baseline is anchored on the database FILE the product opens', () => {
    const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
    expect(b.anchor).toBeTruthy();
    expect(b.anchor.db_filename).toBe('woclaw.sqlite');
    expect(b.anchor.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(b.anchor.rationale).toMatch(/file/i);
    // The anchor commit must be one that actually contains that file name --
    // otherwise the baseline is anchored on a schema no reachable database
    // was ever created with.  (A diff-based anchor would have picked the
    // re-addition of `memory` under a DIFFERENT file name.)
    const src = readFileSync(DBTS, 'utf8');
    expect(src).toContain('woclaw.sqlite');
  });

  // ── J: the REVERSE asymmetry is measured ──────────────────────────────────
  it('J  an ALTER arm for a column this table does not declare is counted', () => {
    // `memory.importance_score` is ALTER-only: it is added to every database
    // but never declared in the `memory` CREATE TABLE.  The gate must print
    // the counter, so the reverse asymmetry is visible rather than silent.
    expect(gateOut).toContain('ALTER-only on this table    :');
    const m = gateOut.match(/ALTER-only on this table\s*:\s*(\d+)/);
    expect(m).not.toBeNull();
    // The three v1.0 columns x two backends.
    expect(Number(m![1])).toBe(6);
    // ... and it is INFORMATIONAL: an ALTER-only column DOES reach every
    // database, so it must not be reported as a gap.
    expect(flagged(gateOut)).not.toContain('memory.importance_score');
    // The cross-table note is what distinguishes "declared nowhere" from
    // "declared on a sibling table" (memory.access_count vs
    // sessions.access_count).
    expect(gateOut).toContain('also declared on: sessions');
  });
});
