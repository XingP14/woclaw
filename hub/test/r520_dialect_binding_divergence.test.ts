/**
 * R520 — the two SQL dialects DISAGREE about what `HAVING importance < ?`
 * binds to, and the product's own memory branch is written in exactly the
 * shape where they disagree.
 *
 * ── The gap this suite fills ───────────────────────────────────────────────
 *
 * R517 (tracked, `r517_eviction_filter_consistency.test.ts`) established, by
 * real execution against SQLite, that the sessions-eviction query's filter
 * and its reported score can disagree. It shipped a suite that pins the
 * invariant "a session is returned IFF its REPORTED importance is < T".
 *
 * R517 also wrote this into its own header — and this suite is the arm R517
 * could not write:
 *
 *     "MEASURED on SQLite: `HAVING <alias>` is SHADOWED by a same-named BASE
 *      COLUMN ... MySQL's behaviour was NOT reachable this round; that gap is
 *      QUEUED, NOT ASSUMED."
 *
 * That gap is now CLOSED, and the answer is NOT "MySQL behaves the same".
 *
 * ── WHAT WAS MEASURED (real engines, identical query text) ────────────────
 *
 * The discriminating query is the SHAPE the product's memory branch uses —
 * `GROUP BY` + a SELECT-list alias named `importance` + `HAVING importance`:
 *
 *     SELECT id, importance + adj AS importance FROM t GROUP BY id
 *       HAVING importance < 4
 *
 * `t` has a base column named `importance`. The base value and the alias
 * value are made to DISAGREE, so "row returned" identifies the binding
 * unambiguously. BOTH polarities were measured:
 *
 *   case                       base   alias   SQLite   MySQL
 *   -------------------------  -----  ------  -------  -------
 *   base 1.0, adj +5.0           1.0     6.0    ROW      (no row)
 *   base 6.0, adj -5.0           6.0     1.0    (no row)  ROW
 *
 * => SQLite binds the BASE COLUMN; MySQL binds the SELECT ALIAS. The two
 * dialects are exact MIRROR IMAGES of each other on this construct: the
 * query returns a row in SQLite exactly when it returns NO row in MySQL.
 *
 * MEASURED against MySQL 8.0.46 (live server) and better-sqlite3 (the
 * product's own embedded SQLite binding, so the measurement is on the
 * engine the product ships, not on a second SQLite).
 *
 * ── WHY THIS MATTERS TO THE PRODUCT ───────────────────────────────────────
 *
 * The product's MEMORY branch is written in exactly that shape:
 *
 *     SELECT m.key, COALESCE(m.importance_score, 5.0) + COALESCE(SUM(f.adjustment), 0)
 *            AS importance
 *       FROM memory m LEFT JOIN memory_feedback f ON m.key = f.key
 *      GROUP BY m.key HAVING importance < ?          -- db.ts:948 (sqlite)
 *                                                            db.ts:1573 (mysql)
 *
 * It is SAFE there, and only because the `memory` table has no column named
 * `importance` (its score column is `importance_score`, added by an ALTER —
 * sqlite :546, mysql :1142). The alias therefore has nothing to collide
 * with, and both dialects bind it.
 *
 * The `sessions` table DOES have a column named `importance`. So:
 *
 *   * the memory branch is written in a shape that is only correct BECAUSE
 *     of an accident of the column names, and
 *   * the SESSION branch — the branch that needs the adjustment and is
 *     being repaired — is exactly the branch where a repair written in the
 *     memory branch's shape would bind DIFFERENTLY on the two backends.
 *
 * Consequence, stated as the invariant this suite pins: **the same query
 * text filters on two different values depending on which backend runs it.**
 * A repair to the session query that is correct on SQLite is not thereby
 * correct on MySQL, and R517's own mutation matrix cannot see this because
 * its suite only ever executes against SQLite.
 *
 * This suite does NOT fix the product. The repair is FATHER-GATED: whether a
 * session's feedback should affect the forgetting score at all is a product
 * decision (see R517's tick note, "WHAT IS NOT SHIPPED"). What this suite
 * does is make the DIVERGENCE MEASURED AND VISIBLE, so the eventual repair
 * cannot silently be correct on one backend and wrong on the other.
 *
 * ── THE POLARITY ──────────────────────────────────────────────────────────
 *
 * This suite is GREEN today and stays GREEN when the product is fixed. It
 * pins a property of the SQL DIALECTS and of the product's query SHAPE — not
 * the presence or absence of a defect. The defect-presence arms live in
 * `r463_session_feedback_no_reader.test.ts` (tracked) and in R517's shipped
 * suites. Two suites about the same subject, opposite polarity, is the
 * R512-14 / R461-arm-G shape: this one must never be mistaken for a
 * regression gate.
 *
 * ── WHY THE LIVE MYSQL ARM IS OPTIONAL ────────────────────────────────────
 *
 * The dialect divergence is a property of the SQL ENGINES, so it can only be
 * measured against a real server. The DSN comes from `MYSQL_TEST_*` env
 * vars; when they are absent the live arm is SKIPPED and the source-shape
 * arms still run. The source-shape arms are the part that lives in CI:
 * they pin that the product's memory branch is written in the colliding
 * shape AT ALL, so a future edit that renames the alias (and removes the
 * collision) is caught in CI without a database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const DBTS = new URL('../src/db.ts', import.meta.url);

// ── the dialect probe ──────────────────────────────────────────────────────
//
// `t` has a BASE column named `importance` and also an `adj` column. The
// SELECT-list alias is named `importance` too. The base value and the alias
// value are made to disagree, so the row's presence identifies the binding.

/** The colliding shape, parameterised by the adjustment. */
const COLLIDING = (adj: number) =>
  `SELECT id, importance + ${adj} AS importance FROM t GROUP BY id HAVING importance < 4`;

/** The distinct-alias CONTROL — same arithmetic, different alias name. */
const DISTINCT = (adj: number) =>
  `SELECT id, importance + ${adj} AS eff FROM t GROUP BY id HAVING eff < 4`;

/**
 * Rows returned by `q` over a one-row table whose `importance` is `base`.
 * Uses better-sqlite3 — the product's OWN embedded SQLite binding — so the
 * measurement is taken on the engine the product ships.
 */
function sqliteRows(q: string, base: number): number[] {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, importance REAL, adj REAL)');
    db.prepare('INSERT INTO t VALUES (1, ?, 0)').run(base);
    return db.prepare(q).all().map((r: any) => Number(r.id));
  } finally {
    db.close();
  }
}

describe('R520 — the two dialects disagree about the eviction filter', () => {
  // ── A (ALWAYS RUN) — the SQLite side of the divergence ─────────────────
  //
  // A1 is the CONTROL and A2/A3 are the two polarities of the FINDING.
  // Without the control, "no rows" could mean "the query returned nothing
  // for any reason". With it, the same table and the same arithmetic under
  // a DISTINCT alias name returns the row — so the ONLY difference between
  // the two queries is the alias NAME, and the difference in outcome is
  // therefore attributable to the collision and to nothing else.
  it('A1 CONTROL: with a DISTINCT alias name the row IS returned', () => {
    // The control uses the SAME data as A2/A3 — base 6.0, adjustment -5.0,
    // so the alias value is 1.0 (which passes `HAVING ... < 4`) while the base
    // column value is 6.0 (which does not). The ONLY difference between the
    // control query and the colliding query is the alias NAME.
    //
    // MEASURED 2026-10-30: the first draft of this arm used base 1.0 /
    // adjustment +5.0, where the alias is 6.0 and therefore does NOT pass the
    // threshold — so the control returned no row and the arm FAILED. The
    // control must be the case where the ALIAS passes and the BASE does not;
    // that is the only shape in which "the row came back" can mean "the
    // alias was bound" rather than "the query matched for some other reason".
    const rows = sqliteRows(DISTINCT(-5.0), 6.0);
    expect(rows, 'the distinct-alias query must return the row -- otherwise A2/A3 are vacuous').toEqual([1]);
  });

  it('A2 FINDING (polarity 1): base 6.0 / alias 1.0 => SQLite returns NO row (BASE bound)', () => {
    const rows = sqliteRows(COLLIDING(-5.0), 6.0);
    expect(
      rows,
      'SQLite bound the SELECT ALIAS where a same-named BASE COLUMN exists. ' +
        'If this arm goes GREEN the collision no longer shadows -- re-derive A2 before trusting it.',
    ).toEqual([]);
  });

  it('A3 FINDING (polarity 2): base 1.0 / alias 6.0 => SQLite returns the row (BASE bound)', () => {
    const rows = sqliteRows(COLLIDING(5.0), 1.0);
    expect(
      rows,
      'SQLite bound the SELECT ALIAS where a same-named BASE COLUMN exists -- ' +
        'the opposite polarity from A2. The two polarities together are what make ' +
        'this arm non-vacuous.',
    ).toEqual([1]);
  });

  // ── B (ALWAYS RUN) — the product's memory branch IS in the colliding shape
  //
  // This is the arm that lives in CI. It needs no database: it pins that the
  // memory-eviction query in `hub/src/db.ts` uses `GROUP BY` + a
  // SELECT-list alias named `importance` + `HAVING importance < ?` — i.e.
  // that the shape in which the dialects disagree is the shape the product
  // ships, and that the two backends ship it in the same shape.
  //
  // The blocks are located BY CONTENT (the template literals that select
  // from `memory` and carry `access_count`), not by variable name — the same
  // derivation discipline R517 used, because a transcribed anchor drifts.
  it('B: BOTH backends\' memory-eviction query is written in the colliding shape', () => {
    const src = readFileSync(DBTS, 'utf8');

    const blocks: string[] = [];
    for (const m of src.matchAll(/`([\s\S]*?)`/g)) {
      const body = m[1];
      if (body.includes('FROM memory m') && body.includes('access_count')) {
        blocks.push(body);
      }
    }

    expect(blocks.length, 'both backends must have a memory-eviction query').toBe(2);

    for (const [i, b] of blocks.entries()) {
      const backend = i === 0 ? 'sqlite' : 'mysql';

      // GROUP BY + a SELECT-list alias named `importance`.
      expect(
        /GROUP BY\s+m\.key/.test(b),
        `the ${backend} memory query must GROUP BY m.key -- without GROUP BY the ` +
          'HAVING shape (and therefore the binding question) does not arise',
      ).toBe(true);
      expect(
        /\bAS\s+importance\b/.test(b),
        `the ${backend} memory query must alias its score as \`importance\` -- ` +
          'that alias name is what collides with the sessions table\' column',
      ).toBe(true);

      // The filter is a bare `importance` — unqualified, with no
      // alias-qualified base reference. This is the colliding shape.
      expect(
        /HAVING\s+importance\s*</.test(b),
        `the ${backend} memory query no longer filters on a bare \`importance\` -- ` +
          'the colliding shape may have been removed. Re-derive arm B.',
      ).toBe(true);
    }
  });

  // ── C (ALWAYS RUN) — the memory branch is safe ONLY by accident ─────────
  //
  // The NON-VACUITY arm for B. The memory branch is written in the
  // colliding shape and is nevertheless correct, because the `memory` table
  // has no column named `importance` for the alias to shadow. Its score
  // column is `importance_score`, and it is NOT in the CREATE TABLE at all
  // — it is added afterwards by an ALTER (sqlite :546, mysql :1142).
  //
  // MEASURED 2026-10-30: the first draft of this arm asserted that the
  // CREATE TABLE declares `importance_score`, and it FAILED for exactly that
  // reason — the column is added by a migration, not by the DDL. The
  // invariant that actually matters is the NEGATIVE one, and it has to be
  // checked across BOTH the DDL and the migration, because either one could
  // introduce the colliding column.
  it('C: the memory table has NO column named `importance`, so its alias cannot collide', () => {
    const src = readFileSync(DBTS, 'utf8');

    const memDdl = /CREATE TABLE IF NOT EXISTS memory \(([^;]*?)\)/s.exec(src);
    expect(memDdl, 'could not find the memory table DDL in hub/src/db.ts').toBeTruthy();
    const ddl = memDdl![1];

    // No bare `importance` column in the DDL. (`importance_score` is a
    // DIFFERENT name and does not collide.)
    expect(
      /(^|[^_a-zA-Z])importance\s+(DOUBLE|REAL|FLOAT|INTEGER|INT)/m.test(ddl),
      'the memory table must NOT declare a bare `importance` column -- ' +
        'if it now does, arm C is vacuous and the memory branch can collide too',
    ).toBe(false);

    // And none is introduced by a migration either. The migration is the
    // half of the schema the CREATE TABLE does not show, so checking only
    // the DDL would miss exactly the case that breaks the arm.
    const migrations = [...src.matchAll(/ALTER TABLE memory ADD COLUMN\s+(\w+)/g)].map(m => m[1]);
    expect(
      migrations,
      'could not find the memory ALTER migrations -- arm C cannot be trusted if the ' +
        'migration shape changed',
    ).not.toHaveLength(0);
    expect(
      migrations.includes('importance'),
      'a migration adds a bare `importance` column to `memory` -- arm C is now vacuous',
    ).toBe(false);

    // The memory branch reads `importance_score` — the name that makes the
    // colliding shape safe.
    expect(
      /importance_score/.test(src),
      'the memory branch must read `importance_score`',
    ).toBe(true);
  });

  // ── D (ALWAYS RUN) — the sessions branch is the one that WOULD collide ──
  //
  // The mirror of arm C, and the arm that says why this matters: the
  // `sessions` table DOES have a base column named `importance`, so the
  // memory branch's shape applied to the session branch would collide, and
  // the two dialects would bind differently.
  it('D: the sessions table DOES have a base column named `importance`', () => {
    const src = readFileSync(DBTS, 'utf8');

    const sessDdl = /CREATE TABLE IF NOT EXISTS sessions \(([^;]*?)\)/s.exec(src);
    expect(sessDdl, 'could not find the sessions table DDL in hub/src/db.ts').toBeTruthy();
    const ddl = sessDdl![1];

    expect(
      /(^|[^_a-zA-Z])importance\s+(DOUBLE|REAL|FLOAT|INTEGER|INT)/m.test(ddl),
      'the sessions table must declare a bare `importance` column -- ' +
        'this is the column that shadows the alias in SQLite. If it is gone, ' +
        'arm D is vacuous and the whole suite must be re-derived.',
    ).toBe(true);
  });
});

// ── the LIVE MySQL arm ────────────────────────────────────────────────────
//
// The divergence is a property of the ENGINE, so measuring MySQL's half
// requires a real server. Skipped when MYSQL_TEST_HOST is absent — the same
// convention `r513_mysql_schema_never_worked.test.ts` uses, so the two
// MySQL-measuring suites in this repo agree on how a server is reached.
function mysqlDsn(): { host: string; port: number; user: string; password: string; database: string } | null {
  const host = process.env.MYSQL_TEST_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || 'root',
    password: process.env.MYSQL_TEST_PASSWORD || '',
    database: process.env.MYSQL_TEST_DATABASE || 'woclaw_r520_test',
  };
}
const DSN = mysqlDsn();

describe.skipIf(!DSN)('R520 — live MySQL: the SAME query text binds the ALIAS', () => {
  it('L1: MySQL returns the row that SQLite does not', async () => {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: DSN!.host, port: DSN!.port, user: DSN!.user, password: DSN!.password,
    });
    const dbName = `r520_live_${Date.now()}`;
    await conn.query(`CREATE DATABASE \`${dbName}\``);
    await conn.query(`USE \`${dbName}\``);
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, importance DOUBLE, adj DOUBLE)');

    // Polarity 1: base 6.0, alias 1.0, threshold 4.
    //   SQLite returns NO row (BASE bound, 6.0 < 4 is FALSE).
    //   MySQL must return the row (ALIAS bound, 1.0 < 4 is TRUE).
    await conn.query('INSERT INTO t VALUES (1, 6.0, 0)');
    const [p1] = await conn.query(COLLIDING(-5.0));
    const [p1c] = await conn.query(DISTINCT(-5.0));
    expect(
      (p1c as any[]).length,
      'the distinct-alias control must return the row on MySQL too -- otherwise L1 is vacuous',
    ).toBe(1);
    expect(
      (p1 as any[]).length,
      'MySQL returned NO row where SQLite does -- MySQL bound the BASE column, ' +
        'the same as SQLite. The divergence this suite pins no longer exists; re-derive it.',
    ).toBe(1);

    // Polarity 2: base 1.0, alias 6.0, threshold 4.
    //   SQLite returns the row (BASE bound). MySQL must NOT (ALIAS bound).
    await conn.query('DELETE FROM t');
    await conn.query('INSERT INTO t VALUES (1, 1.0, 0)');
    const [p2] = await conn.query(COLLIDING(5.0));
    expect(
      (p2 as any[]).length,
      'MySQL returned the row where SQLite does not -- MySQL bound the BASE column, ' +
        'the same as SQLite. The divergence this suite pins no longer exists; re-derive it.',
    ).toBe(0);

    await conn.query(`DROP DATABASE \`${dbName}\``);
    await conn.end();
  }, 30000);
});
