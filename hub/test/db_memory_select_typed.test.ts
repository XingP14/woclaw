import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the SqliteStorage SELECT .get(key) MemoryRowSqlite cast
 * migration (07-03 03:03 cron).
 *
 * Before this round, hub/src/db.ts had 2 .get(key) sites on the
 * `SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
 *  FROM memory WHERE key = ?` query without any typed cast:
 *   (a) L672 in SqliteStorage.setMemory tx() inner — `existing = ...get(payload.key)`
 *   (b) L733 in SqliteStorage.getMemory()        — `row     = ...get(key)`
 *
 * Both consumed the raw `unknown` return from better-sqlite3 .get() and
 * either passed it to mapMemoryRow (which retained row: any) or
 * dereferenced `existing.value/tags/ttl` (which under strict:false was
 * silently allowed but widens the row type at the boundary).
 *
 * Risk gated by this test:
 *   (1) re-introduction of a bare `.get(key)` without a typed cast — the
 *       cast IS the typed-row boundary; dropping it would silently widen
 *       the row to unknown and re-open the door to a future refactor
 *       landing on top of an untyped boundary.
 *   (2) accidental narrowing to a non-MemoryRowSqlite type (e.g. `any`)
 *       that bypasses the typed-row chain established by 9b7f4ee +
 *       9d2b5eb + 01cb013 + 6e78387.
 *   (3) breaking the inner `if (existing)` truthy guard by changing the
 *       cast to a non-undefinedable type (e.g. just `MemoryRowSqlite`)
 *       which would prevent the consumer from using the absence check.
 *
 * Why a code-scanning test instead of a runtime test:
 *   the behavior change is purely a TypeScript type-narrowing annotation
 *   (zero runtime difference — better-sqlite3 .get() still returns
 *   `unknown | undefined` regardless of the cast). The only way to
 *   pin "the cast is present and uses the right shape" is a regex on
 *   the source file. This mirrors the pattern already used by
 *   hub/test/db_decrypt_inline.test.ts (07-03 02:23 cron) which gates
 *   the trivial-wrapper-elimination pattern on the source itself.
 */

const DB_PATH = join(process.cwd(), 'src', 'db.ts'); // cwd is hub/ when invoked via `npx vitest run` from hub/

describe('SqliteStorage SELECT .get(key) MemoryRowSqlite cast migration (07-03 03:03 cron)', () => {
  const dbSrc = readFileSync(DB_PATH, 'utf8');

  it('contains exactly 2 typed `as MemoryRowSqlite | undefined` casts on memory SELECT .get(key) sites', () => {
    // 2 sites expected: setMemory tx() inner existing (L672) + getMemory row (L733).
    // Regex matches `).get(<arg>) as MemoryRowSqlite | undefined;` on memory-table SELECT.
    const matches = dbSrc.match(
      /\)\.get\((?:payload\.)?key\)\s+as\s+MemoryRowSqlite\s*\|\s*undefined\s*;/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it('contains zero bare `).get(payload.key);` or `).get(key);` SELECT sites on the memory table', () => {
    // Both sites must use the canonical `(as MemoryRowSqlite | undefined)`
    // shape. A bare `.get(...)` without the cast is the regression.
    //
    // The regex is narrow on purpose: only the `SELECT ... FROM memory` block
    // calls `.get(key)` (other .get() sites in the file pass different column
    // lists or arguments — sessions, messages, extraction_queue — and are
    // already covered by other regression tests or already have a different
    // typed-row cast like `as SessionRowSqlite`, `as CountRow`,
    // `as MaxVersionRow`).
    const bareMemoryGet = dbSrc.match(
      /SELECT\s+key,\s+value,\s+tags,\s+ttl,\s+expire_at,\s+updated_at,\s+updated_by[\s\S]*?\)\.get\((?:payload\.)?key\)\s*;/g,
    );
    // bareMemoryGet matches SELECT blocks whose terminator is `).get(key);`
    // or `).get(payload.key);` WITHOUT a cast. Should be 0 after the narrow.
    expect(bareMemoryGet).toBeNull();
  });

  it('inner `if (existing)` truthy guard preserved on the tx() site', () => {
    // The cast is `MemoryRowSqlite | undefined`, so the existing
    // `if (existing)` guard narrows existing to MemoryRowSqlite. Dropping
    // the | undefined from the cast would break this narrowing and surface
    // a tsc error on `existing.value` etc.
    expect(dbSrc).toMatch(/if\s*\(\s*existing\s*\)/);
  });

  it('getMemory `if (!row) return undefined` early-return preserved', () => {
    // Symmetric guard on the consumer side: | undefined cast requires the
    // absence check to remain for the function's Promise<DBMemory | undefined>
    // contract. If a future refactor drops the early-return, downstream
    // mapMemoryRow(row) would receive `undefined` and throw.
    expect(dbSrc).toMatch(/if\s*\(\s*!row\s*\)\s+return\s+undefined\s*;/);
  });
});
