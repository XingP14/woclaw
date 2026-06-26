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
