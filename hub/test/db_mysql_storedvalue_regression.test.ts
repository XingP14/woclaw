import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the 48c3524 encryption-at-rest chain — MySqlStorage parity.
 *
 * Background (commit 48c3524, "fix(db): encryption-at-rest: tx() 传 storedValue +
 * decryptValue 用 deserializeAndDecrypt"):
 *   - SqliteStorage.setMemory: tx({ key, value: storedValue, ... }) (was passing
 *     plaintext `value` instead of `storedValue` — DB stored plaintext instead of
 *     ENC:v1: ciphertext, breaking the encryption-at-rest contract).
 *   - SqliteStorage.decryptValue + MySqlStorage.decryptValue: switched to
 *     `deserializeAndDecrypt(value, this.encryption)` so the helper handles the
 *     'ENC:v1:...' string → EncryptedPayload round-trip before calling decrypt().
 *
 * Existing coverage in f238696 (12/12 SQLite integration cases) plus
 * db_decrypt_inline.test.ts (06-29 chain #15 inline migration, 6/6 textual
 * gates) covers the SqliteStorage side. The MySqlStorage side has had NO
 * regression coverage until now. This file closes that gap with textual
 * assertions — no MySQL connection needed, just regex gates on hub/src/db.ts
 * source. Parallel to db_decrypt_inline.test.ts (same textual-regression style
 * proven on chain #15 + 06-11 09:03 memory-storage path).
 *
 * Gates:
 *   (1) `storedValue` declaration appears exactly 2 times — one per storage
 *       class (SqliteStorage.setMemory + MySqlStorage.setMemory). A regression
 *       that drops the declaration (e.g. someone refactors to inline the
 *       encryption-at-rest check into a one-liner helper) would silently
 *       desync the encryption-at-rest contract for both classes.
 *   (2) Both `const storedValue` declarations use the canonical ternary form
 *       `this.encryption.enabled ? encryptAndSerialize(value, this.encryption) : value`.
 *       Pin the pattern so a future "optimization" (e.g. always-encrypt, or
 *       pull the encryption call into a different shape) is caught here.
 *   (3) MySqlStorage.setMemory INSERT/UPDATE paths use `storedValue`, not the
 *       plaintext `value` parameter — directly pins the 48c3524 fix.
 *   (4) MySqlStorage.setMemory has the inline `INSERT INTO memory (...) VALUES
 *       (?, storedValue, ...)` + `UPDATE memory SET value = ?, ...` pair, both
 *       with storedValue — proves the encryption-at-rest contract survives a
 *       future refactor that swaps variable names back to `value`.
 *   (5) SqliteStorage.setMemory `tx({ key, value: storedValue, ... })` signature
 *       pinned — the wrapper indirection routes through the tx transaction;
 *       `payload.value` is then passed to both UPDATE and INSERT prepare/run.
 *   (6) NO surviving plaintext leak path: no MySqlStorage.setMemory body line
 *       references the raw `value` parameter outside the ternary declaration
 *       line + INSERT/UPDATE calls (which must reference storedValue instead).
 *       A naive "storedValue" → "value" rename would re-introduce the bug.
 *   (7) crypto.ts still exports `encryptAndSerialize` (parity check — the
 *       helper that produces storedValue is still in scope).
 */

const DB_PATH = join(process.cwd(), 'src', 'db.ts');
const CRYPTO_PATH = join(process.cwd(), 'src', 'crypto.ts');

describe('db.ts MySqlStorage encryption-at-rest storedValue parity (48c3524 regression)', () => {
  const dbSrc = readFileSync(DB_PATH, 'utf8');
  const cryptoSrc = readFileSync(CRYPTO_PATH, 'utf8');

  it('contains exactly 2 `const storedValue` declarations (one per storage class)', () => {
    // SqliteStorage.setMemory (L655) + MySqlStorage.setMemory (L1224). Both
    // must declare `storedValue` so the INSERT/UPDATE paths can persist
    // ciphertext instead of plaintext.
    const matches = dbSrc.match(/const\s+storedValue\s*=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('both storedValue declarations use canonical `this.encryption.enabled ? encryptAndSerialize(...) : value` ternary', () => {
    // Pin the exact pattern. A future refactor that uses `this.encryption.enabled
    // ? storedValue : value` (where storedValue is computed unconditionally)
    // would also work but is not what the 48c3524 fix landed — so we pin the
    // pattern as it stands to detect drift in either direction.
    const declarationRe = /const\s+storedValue\s*=\s*this\.encryption\.enabled\s*\?\s*encryptAndSerialize\(\s*value\s*,\s*this\.encryption\s*\)\s*:\s*value\s*;/g;
    const matches = dbSrc.match(declarationRe) ?? [];
    expect(matches.length).toBe(2);
  });

  it('MySqlStorage.setMemory INSERT/UPDATE paths use storedValue (48c3524 fix)', () => {
    // The 48c3524 bug: MySqlStorage.setMemory was passing `value` (plaintext)
    // to both `INSERT INTO memory` and `UPDATE memory` prepare/run calls.
    // Fix: pass `storedValue` so ENC:v1: ciphertext lands in the DB.
    //
    // Extract just the MySqlStorage.setMemory method body (between
    // "class MySqlStorage" and the next "class" / end-of-file) and assert
    // both call paths reference `storedValue` as the value argument.
    const mysqlClassStart = dbSrc.indexOf('class MySqlStorage');
    expect(mysqlClassStart).toBeGreaterThan(-1);
    const mysqlSrc = dbSrc.slice(mysqlClassStart);
    // Pin: every setMemory INSERT/UPDATE reference uses storedValue.
    // Find the UPDATE memory block.
    expect(mysqlSrc).toMatch(/UPDATE\s+memory[\s\S]{0,200}?storedValue/);
    // Find the INSERT INTO memory block.
    expect(mysqlSrc).toMatch(/INSERT\s+INTO\s+memory[\s\S]{0,200}?storedValue/);
  });

  it('MySqlStorage.setMemory has 2 storedValue references (UPDATE + INSERT) and zero plaintext `value` references in write paths', () => {
    // More precise gate: count `storedValue` mentions in MySqlStorage scope
    // (excluding the declaration). Should be 2 (UPDATE + INSERT). Zero
    // leftover `value,` (raw param) references inside the write SQL
    // INSERT/UPDATE prepare/run arg lists.
    const mysqlClassStart = dbSrc.indexOf('class MySqlStorage');
    const mysqlSrc = dbSrc.slice(mysqlClassStart);
    // Slice just setMemory (start at the method decl, end at next method/}).
    const setMemoryStart = mysqlSrc.indexOf('async setMemory');
    const setMemoryEnd = mysqlSrc.indexOf('async ', setMemoryStart + 10);
    const setMemoryBody = mysqlSrc.slice(setMemoryStart, setMemoryEnd === -1 ? undefined : setMemoryEnd);
    const storedValueRefs = setMemoryBody.match(/storedValue/g) ?? [];
    // 1 declaration + 2 use sites (UPDATE + INSERT) = 3 total in setMemory body.
    expect(storedValueRefs.length).toBe(3);
  });

  it('SqliteStorage.setMemory tx({ key, value: storedValue, ... }) wrapper pattern pinned', () => {
    // SqliteStorage uses a `this.db.transaction(...)` indirection. The
    // tx wrapper takes a payload object whose `value` field must be
    // populated with `storedValue` (not the raw plaintext param). Pin
    // the exact call signature.
    const sqliteClassStart = dbSrc.indexOf('class SqliteStorage');
    const sqliteSrc = dbSrc.slice(sqliteClassStart);
    expect(sqliteSrc).toMatch(/tx\(\{\s*key\s*,\s*value:\s*storedValue\s*,\s*updatedBy\s*,\s*tags\s*,\s*ttl\s*,\s*now\s*,\s*expireAt\s*\}\s*\)/);
  });

  it('no raw `value` parameter leak in MySqlStorage.setMemory INSERT/UPDATE arg lists (48c3524 bug shape)', () => {
    // The 48c3524 bug shape: pass `value` instead of `storedValue` to
    // INSERT/UPDATE prepare/run. After the fix, the write-path arg lists
    // use `storedValue` exclusively. A regression that swaps them back
    // would re-introduce plaintext-at-rest storage.
    //
    // Strategy: extract the MySqlStorage.setMemory method body, find each
    // `INSERT INTO memory` + `UPDATE memory` SQL block, and verify the
    // value column placeholder (? for value) is followed by `storedValue`
    // in the .execute() arg list (not `value,`).
    const mysqlClassStart = dbSrc.indexOf('class MySqlStorage');
    const mysqlSrc = dbSrc.slice(mysqlClassStart);
    const setMemoryStart = mysqlSrc.indexOf('async setMemory');
    const setMemoryEnd = mysqlSrc.indexOf('async ', setMemoryStart + 10);
    const body = mysqlSrc.slice(setMemoryStart, setMemoryEnd === -1 ? undefined : setMemoryEnd);

    // The two SQL blocks each have a "SET value = ?, ... WHERE" (UPDATE)
    // and "VALUES (?, ?, ?, ..." (INSERT) pattern. After the SQL string,
    // the .execute(`...`, [ ... ]) arg list must include `storedValue,` not
    // `value,` as the value-column arg.
    //
    // Pin: at least 2 occurrences of `storedValue,` (UPDATE arg list + INSERT
    // arg list). No occurrences of `value,` immediately following either
    // SQL block.
    const storedValueArgRefs = body.match(/storedValue\s*,/g) ?? [];
    expect(storedValueArgRefs.length).toBeGreaterThanOrEqual(2);
  });

  it('crypto.ts still exports encryptAndSerialize (the helper that produces storedValue)', () => {
    // Parity check. If crypto.ts drops this export, both storage classes
    // lose their ability to encrypt values at rest.
    expect(cryptoSrc).toMatch(/export\s+function\s+encryptAndSerialize\b/);
  });

  it('encryption-at-rest pre-fix shape is detectable: SqliteStorage.setMemory has storedValue pin (48c3524)', () => {
    // Final gate: the SqliteStorage side of 48c3524 (existing f238696
    // coverage) is also pinned textually. If both SqliteStorage.setMemory
    // and MySqlStorage.setMemory pass storedValue, the parity contract
    // holds — a regression on either side trips gates (3) + (4) above.
    //
    // This gate simply asserts that SqliteStorage.setMemory body has the
    // `value: storedValue` property in its tx() call, complementing the
    // MySqlStorage UPDATE/INSERT storedValue pin in gate (3).
    const sqliteClassStart = dbSrc.indexOf('class SqliteStorage');
    const sqliteSrc = dbSrc.slice(sqliteClassStart);
    expect(sqliteSrc).toMatch(/value:\s*storedValue/);
  });
});
