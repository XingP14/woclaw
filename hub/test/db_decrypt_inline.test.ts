import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the db.ts decryptValue inline migration (07-03 02:23 cron).
 *
 * Before this round, hub/src/db.ts contained 2 byte-identical private
 * `decryptValue(value: string): string` wrapper methods — one in
 * SqliteStorage (was L732) and one in MySqlStorage (was L1233). Each was
 * a one-liner that just delegated to `safeDecryptValue(value, this.encryption)`
 * (the helper extracted earlier from the same byte-identical private method
 * pattern). Three latent risks:
 *   (1) wrapper adds zero behavior — pure indirection
 *   (2) duplicate method signature across two storage classes (drift
 *       risk — a future change to one but not the other would silently
 *       desync the encryption-at-rest contract)
 *   (3) 6 call sites (3 per class) add a layer that confuses readers
 *       trying to follow the decryption flow into crypto.ts
 *
 * rFIX: delete both private wrappers + their 3-line JSDoc blocks; inline
 * `safeDecryptValue(X, this.encryption)` directly at the 6 call sites
 * (SqliteStorage L737/L759/L773 + MySqlStorage L1311/L1333/L1347). Net
 * db.ts -16 lines (1525 → 1509). zero behavior change — wrapper body
 * was a single `return safeDecryptValue(value, this.encryption)` call,
 * so inlining is byte-identical at runtime.
 *
 * This regression test gates:
 *   (1) NO `private decryptValue(` declaration remains in db.ts (both
 *       wrappers deleted)
 *   (2) NO inline comment "Decrypt value if encryption is enabled" /
 *       "byte-identical private method" survives in db.ts (both
 *       JSDoc blocks deleted alongside the wrappers)
 *   (3) exactly 6 `safeDecryptValue(` call sites in db.ts (3 in
 *       SqliteStorage + 3 in MySqlStorage) — one per memory decryption
 *       surface (getMemory / getAllMemory / getMemoryVersions)
 *   (4) all 6 call sites use the canonical `(X, this.encryption)`
 *       shape — no caller accidentally drops the provider argument
 *   (5) safeDecryptValue is imported from crypto (not duplicated or
 *       re-implemented in db.ts)
 */

const DB_PATH = join(process.cwd(), 'src', 'db.ts'); // process.cwd() resolves to hub/ when test is invoked via `npx vitest run`
const CRYPTO_PATH = join(process.cwd(), 'src', 'crypto.ts');

describe('db.ts decryptValue wrapper inline migration (07-03 02:23 cron)', () => {
  const dbSrc = readFileSync(DB_PATH, 'utf8');

  it('contains zero `private decryptValue(` declarations (both wrappers deleted)', () => {
    // The wrappers lived at L732 (SqliteStorage) + L1233 (MySqlStorage).
    // Both must be gone after the inline migration.
    expect(dbSrc).not.toMatch(/private\s+decryptValue\s*\(/);
  });

  it('contains zero JSDoc references to the deleted wrapper ("byte-identical private method" phrase)', () => {
    // The 3-line comment block above each wrapper said:
    //   "// Decrypt value if encryption is enabled."
    //   "// Behavior lives in crypto.safeDecryptValue (extracted from this"
    //   "// byte-identical private method that previously existed in both"
    //   "// SqliteStorage and MySqlStorage)."
    // The "byte-identical private method" phrase is the unique signature
    // of the deleted comment block. Test for absence of both the unique
    // phrase and the "Decrypt value if encryption is enabled." comment.
    expect(dbSrc).not.toMatch(/byte-identical private method/);
    expect(dbSrc).not.toMatch(/Decrypt value if encryption is enabled\./);
  });

  it('contains exactly 6 safeDecryptValue(...) call sites (3 per storage class)', () => {
    // Before migration: 6 calls to this.decryptValue(X).
    // After migration: 6 calls to safeDecryptValue(X, this.encryption).
    // No new calls introduced (inlining is mechanical, 1:1).
    const matches = dbSrc.match(/safeDecryptValue\s*\(/g) ?? [];
    expect(matches.length).toBe(6);
  });

  it('all 6 call sites use canonical (X, this.encryption) shape', () => {
    // Pin the arg shape so a future caller that drops the provider arg
    // (a real risk if the helper signature changes) is caught here.
    const matches = dbSrc.match(/safeDecryptValue\s*\([^)]*\)/g) ?? [];
    expect(matches.length).toBe(6);
    for (const call of matches) {
      expect(call).toMatch(/this\.encryption/);
    }
  });

  it('safeDecryptValue is imported from ./crypto.js (not re-implemented)', () => {
    // The import at top of db.ts already declares safeDecryptValue as
    // a named import from './crypto.js'. Pin the import shape against
    // accidental re-introduction.
    expect(dbSrc).toMatch(/import\s*\{[^}]*\bsafeDecryptValue\b[^}]*\}\s*from\s*['"]\.\/crypto\.js['"]/);
  });

  it('crypto.ts still exports safeDecryptValue (parity check)', () => {
    // The wrapper was the only thing delegating to this helper. After
    // inlining, the helper is still called from 6 sites directly. Make
    // sure crypto.ts hasn't lost the export.
    const cryptoSrc = readFileSync(CRYPTO_PATH, 'utf8');
    expect(cryptoSrc).toMatch(/export\s+function\s+safeDecryptValue\s*\(/);
  });
});
