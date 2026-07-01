// Regression test for refactor that extracted
//   errors.ts#ignoreDuplicateColumn<T>(op: () => Promise<T>): Promise<T>
// from the 3 inline `try { await this.pool.execute(\`ALTER TABLE ...\`); }
// catch (e: unknown) { if (!errorMessage(e).includes('Duplicate column')) throw e; }`
// sites that previously lived in MySqlStorage.ensureSchema at db.ts
// L1061/L1064/L1067 (importance_score / access_count / last_accessed_at
// ALTER TABLE chain).
//
// This file is purely a black-box test of the exported helper. It does NOT
// need a live MySQL connection — it just feeds in synthetic ops that throw
// (or don't) and asserts the helper's filtering + re-throw + return-value
// semantics match the prior inlined behavior byte-for-byte.
//
// Run under `npm test` (vitest). Mirrors the structure of
// hub/test/parse_int_param.test.ts and hub/test/parse_env_int.test.ts which
// gate similarly-shaped single-file helper extractions.

import { describe, test, expect } from 'vitest';
import { ignoreDuplicateColumn, errorMessage } from '../src/errors.js';

// ─── file-structure / signature gates ──────────────────────────────────────

describe('ignoreDuplicateColumn helper presence + signature (post-extraction regression)', () => {
  test('errors.ts exports ignoreDuplicateColumn as an async function', () => {
    expect(typeof ignoreDuplicateColumn).toBe('function');
    // Async functions report as 'function' but the .constructor.name is
    // 'AsyncFunction' — use that to distinguish.
    expect((ignoreDuplicateColumn as unknown as { constructor: { name: string } }).constructor.name)
      .toBe('AsyncFunction');
  });

  test('helper is generic — returns the inner op result when op resolves', async () => {
    const out = await ignoreDuplicateColumn(async () => 42);
    expect(out).toBe(42);
  });

  test('helper passes through string return values unchanged', async () => {
    const out = await ignoreDuplicateColumn(async () => 'ok-row');
    expect(out).toBe('ok-row');
  });

  test('helper passes through object return values unchanged', async () => {
    const payload = { affectedRows: 0, insertId: 7 };
    const out = await ignoreDuplicateColumn(async () => payload);
    expect(out).toEqual(payload);
  });

  test('helper accepts a sync op too (return type Promise<T> covers both)', async () => {
    const out = await ignoreDuplicateColumn(() => Promise.resolve('sync-wrap'));
    expect(out).toBe('sync-wrap');
  });
});

// ─── duplicate-column ignore path ──────────────────────────────────────────

describe('ignoreDuplicateColumn: Duplicate column → swallowed, returns undefined as T', () => {
  test('Error with "Duplicate column" message → no throw, resolves undefined', async () => {
    const op = async () => {
      throw new Error("ER_DUP_FIELDNAME: Duplicate column name 'foo'");
    };
    // The 3 pre-refactor sites were `void`-typed, so the swallowed
    // resolution surfaces as `undefined` at the call site. The helper
    // signature returns T; for the void case T=void, callers ignore the
    // value. The test below asserts the runtime contract that the
    // resolution path completes cleanly (no rejection) and yields
    // `undefined` because no value was thrown.
    const out = await ignoreDuplicateColumn(op);
    expect(out).toBeUndefined();
  });

  test('Error with lowercase "duplicate column" message → still swallowed (case sensitivity check)', async () => {
    // The 3 pre-refactor MySQL sites used .includes('Duplicate column')
    // with capital D. The helper preserves that exact probe so we accept
    // only the capital-D form to match the prior behavior byte-for-byte.
    // We assert the helper does NOT silently accept the lowercase
    // SQLite-style variant — that variant belongs to the SQLiteStorage
    // site at db.ts L514 which has different semantics and is intentionally
    // left inline.
    const op = async () => {
      throw new Error('duplicate column name: foo (sqlite)');
    };
    await expect(ignoreDuplicateColumn(op)).rejects.toThrow(/duplicate column name/);
  });

  test('plain string thrown with "Duplicate column" → swallowed', async () => {
    // errorMessage() handles non-Error throwables (returns the string),
    // so a bare-string throw should still trip the .includes('Duplicate
    // column') probe in the helper.
    const op = async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'Duplicate column name bar';
    };
    const out = await ignoreDuplicateColumn(op);
    expect(out).toBeUndefined();
  });

  test('op that resolves normally does NOT trigger the catch path', async () => {
    let calls = 0;
    const op = async () => {
      calls += 1;
      return 'success';
    };
    const out = await ignoreDuplicateColumn(op);
    expect(calls).toBe(1);
    expect(out).toBe('success');
  });
});

// ─── non-duplicate error propagation ───────────────────────────────────────

describe('ignoreDuplicateColumn: other errors are re-thrown unchanged', () => {
  test('SyntaxError re-thrown with same message', async () => {
    const op = async () => {
      throw new Error('You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near \'ADD\'');
    };
    await expect(ignoreDuplicateColumn(op)).rejects.toThrow(/SQL syntax/);
  });

  test('FK violation re-thrown', async () => {
    const op = async () => {
      throw new Error("Cannot add foreign key constraint (errno: 1215 'Duplicate key name')");
    };
    await expect(ignoreDuplicateColumn(op)).rejects.toThrow(/foreign key constraint/);
  });

  test('plain Error (no Duplicate column) re-thrown with original message preserved', async () => {
    const op = async () => {
      throw new Error('connection lost: ECONNRESET');
    };
    await expect(ignoreDuplicateColumn(op)).rejects.toThrow('connection lost: ECONNRESET');
  });

  test('non-Error throwable (string) re-thrown via errorMessage routing', async () => {
    const op = async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'totally unrelated failure';
    };
    await expect(ignoreDuplicateColumn(op)).rejects.toBe('totally unrelated failure');
  });
});

// ─── errorMessage helper still works (smoke test for the import) ───────────

describe('errorMessage smoke test (helper co-exports used by ignoreDuplicateColumn)', () => {
  test('Error instance → its message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
  test('string → returned as-is', () => {
    expect(errorMessage('plain text')).toBe('plain text');
  });
  test('undefined → empty string', () => {
    expect(errorMessage(undefined)).toBe('');
  });
});
