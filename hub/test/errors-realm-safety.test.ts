// hub/test/errors-realm-safety.test.ts
//
// WHY THIS FILE EXISTS (2026-10-20 05:03 cron, woclaw rotation).
//
// The sibling project (llm-benchmark) had a RED CI run caused by a REAL
// defect in its byte-identical `errorMessage()` helper: it narrowed caught
// values with `e instanceof Error`, which is realm-sensitive.
//
// The hub carries the same helper (hub/src/errors.ts) AND the same trigger:
// `better-sqlite3` is a NATIVE addon that calls
// `addon.setErrorConstructor(SqliteError)` at module load, and
// `SqliteError.prototype` is chained to whichever `Error.prototype` was live
// in the realm that loaded it LAST. Under a test runner that gives every test
// FILE its own module registry, the prototype the addon captured depends on
// FILE ORDER, so the same database error is `instanceof Error` in one
// ordering and not in another.
//
// When the check fails, `errorMessage()` fell through to `JSON.stringify(e)`.
// `SqliteError.prototype`'s `message` is defined with `enumerable: false`, so
// JSON.stringify DROPS IT ENTIRELY and only `code` survives. The hub's
// `errorMessage()` is used at 30+ catch sites across rest_server.ts /
// db.ts / ws_server.ts, so ANY cross-realm error reaching ANY of them loses
// its message -- a REST 500/400 body degrades from a human-readable message
// to a JSON blob.
//
// This file pins the realm-agnostic narrowing. The cross-realm values are
// constructed deterministically (a `vm` context, and an error class re-rooted
// onto a foreign `Error.prototype`) and do not depend on a native addon or on
// file ordering. A suite that only ever builds errors with the ambient
// `new Error(...)` cannot see this defect at all.

import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'vm';
import { errorMessage, errorToString } from '../src/errors.js';

/**
 * Build an error whose prototype chain is rooted at a FOREIGN realm's
 * `Error.prototype` -- the exact shape `better-sqlite3` produces when its
 * native addon captured the error constructor from another module registry.
 *
 * The foreign `Error.prototype` is taken from a `vm` context, so it is NOT
 * linked to this realm's `Error.prototype` and the ambient `instanceof`
 * check genuinely fails on the result.
 */
function foreignRealmError(message: string): Error {
  const foreignErrorProto = runInNewContext('Error.prototype') as object;
  class ForeignError extends Error {}
  Object.setPrototypeOf(ForeignError.prototype, foreignErrorProto);
  return new (ForeignError as unknown as new (m: string) => Error)(message);
}

describe('errorMessage / errorToString realm safety', () => {
  describe('a genuine error from another realm', () => {
    it('a cross-realm Error is NOT `instanceof Error` but IS error-like', () => {
      const foreign = runInNewContext('new Error("cross realm boom")') as Error;

      // Precondition: this is exactly the condition the old check missed.
      expect(foreign instanceof Error).toBe(false);
      // The property the old code silently dropped.
      expect(foreign.message).toBe('cross realm boom');
    });

    it('errorMessage() returns the cross-realm error message, not a JSON blob', () => {
      const foreign = runInNewContext('new Error("cross realm boom")') as Error;
      expect(errorMessage(foreign)).toBe('cross realm boom');
    });

    it('errorMessage() does not degrade to JSON.stringify for a cross-realm Error', () => {
      // The old fallback produced '{}' for a cross-realm Error: `message` and
      // `stack` are non-enumerable, so JSON.stringify kept nothing.
      const foreign = runInNewContext('new Error("cross realm boom")') as Error;
      expect(errorMessage(foreign)).not.toBe('{}');
    });

    it('errorToString() returns the cross-realm error toString', () => {
      const foreign = runInNewContext('new Error("cross realm boom")') as Error;
      expect(errorToString(foreign)).toBe('Error: cross realm boom');
    });

    it('recognises a cross-realm error SUBCLASS too', () => {
      // A subclass declared in another realm: its name ends in 'Error' but the
      // ambient `instanceof` check fails for the same reason.
      const foreign = runInNewContext(
        'class RangeError extends Error {}; new RangeError("subclass boom")',
      ) as Error;
      expect(foreign instanceof Error).toBe(false);
      expect(errorMessage(foreign)).toBe('subclass boom');
    });
  });

  describe('an error rooted at a foreign Error.prototype (the native-addon shape)', () => {
    it('is not `instanceof Error` in this realm', () => {
      const err = foreignRealmError('captured boom');
      expect(err instanceof Error).toBe(false);
      expect(err.message).toBe('captured boom');
    });

    it('errorMessage() still reads the message', () => {
      expect(errorMessage(foreignRealmError('captured boom'))).toBe('captured boom');
    });

    it('errorToString() still reads the toString', () => {
      expect(errorToString(foreignRealmError('captured boom'))).toBe(
        'Error: captured boom',
      );
    });
  });

  describe('the published contract for NON-error values is unchanged', () => {
    // The realm fix must not swallow the helper's documented fallbacks. A
    // plain object is NOT an error, even when it carries a `message` key --
    // this is the case that a naive duck-typed fix would break.
    it('still JSON-stringifies a plain object throw', () => {
      expect(errorMessage({ code: 42, detail: 'oops' })).toBe(
        JSON.stringify({ code: 42, detail: 'oops' }),
      );
    });

    it('still JSON-stringifies a plain object that carries a message key', () => {
      const plain = { message: 'not an error', code: 'X' };
      expect(errorMessage(plain)).toBe(JSON.stringify(plain));
      expect(errorMessage(plain)).not.toBe('not an error');
    });

    it('still returns the string itself for a thrown string', () => {
      expect(errorMessage('raw string thrown')).toBe('raw string thrown');
    });

    it('still returns empty string for undefined', () => {
      expect(errorMessage(undefined)).toBe('');
    });

    it('still returns "null" for null', () => {
      expect(errorMessage(null)).toBe('null');
    });

    it('still returns Error.message for an ambient Error', () => {
      expect(errorMessage(new Error('boom'))).toBe('boom');
    });

    it('still returns Error.toString() for an ambient Error', () => {
      expect(errorToString(new Error('boom'))).toBe('Error: boom');
    });

    it('still falls back to String() for a circular object', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(typeof errorMessage(circular)).toBe('string');
    });
  });
});
