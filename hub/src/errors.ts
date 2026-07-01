// hub/src/errors.ts
//
// Tiny helpers for `catch (e: unknown)` narrowing. Used by 30+ sites in
// rest_server.ts / db.ts / ws_server.ts that previously declared
// `catch (e: any)` purely to read `e.message`. Replaces the unsafe
// `: any` with the modern TypeScript pattern (unknown + runtime narrowing).
//
// Why: hub/tsconfig.json has `strict: false` and `noImplicitAny: false`,
// so `catch (e)` would silently default to `any` and the change would be
// 0-net. By (a) annotating `: unknown` explicitly and (b) routing `.message`
// reads through a typed helper, we get the same ergonomic string output
// while future-proofing the codebase for a strict-mode upgrade.

/** Safely extract a human-readable message from an unknown caught value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e === undefined) return '';
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Like errorMessage, but returns the full Error.toString() when available. */
export function errorToString(e: unknown): string {
  if (e instanceof Error) return e.toString();
  return errorMessage(e);
}

/**
 * Run a schema-migration-style op, ignoring "Duplicate column" errors.
 *
 * Centralizes the `try { await op } catch (e) { if (!message includes
 * 'Duplicate column') throw e; }` pattern that was previously inlined at
 * 3 sites in MySqlStorage.ensureSchema (importance_score / access_count /
 * last_accessed_at ALTER TABLE chain, db.ts L1061/L1064/L1067 pre-refactor).
 * MySQL raises ER_DUP_FIELDNAME (code 1060) when an ALTER TABLE ADD COLUMN
 * re-applies a column that already exists; the migration is therefore
 * idempotent across repeated restarts. Non-duplicate errors are re-thrown
 * unchanged so genuine schema bugs (syntax errors, FK violations, etc.) still
 * propagate to the caller.
 *
 * Why a helper and not a wrapper around this.pool.execute(): the op is
 * arbitrary (could be a Promise of any return type — currently all 3 sites
 * are `void` but the signature is generic so future migrations that need a
 * row count or inserted id can opt in). The error-message probe is the
 * single point of truth for the "ignore this MySQL errno" decision, which
 * keeps the inlined migration code readable.
 *
 * Detection note: we probe `errorMessage(e).includes('Duplicate column')`
 * rather than checking `e.code === 'ER_DUP_FIELDNAME'` so this works
 * uniformly against the mysql2/promise wrapper (which exposes `e.code` as
 * a string) and against any future driver swap (e.g. mysql ormariadb) where
 * the same SQL state appears as a substring of the human message. The 3
 * pre-refactor sites already used `.includes('Duplicate column')`, so this
 * preserves the prior detection surface byte-for-byte.
 */
export async function ignoreDuplicateColumn<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    if (!errorMessage(e).includes('Duplicate column')) throw e;
    return undefined as T;
  }
}
